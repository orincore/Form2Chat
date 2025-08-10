const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Otp = require('../models/Otp');
const whatsappClient = require('../services/whatsappClient');
const { rateLimit } = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');

// Constants
const OTP_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes in milliseconds
const MAX_OTP_ATTEMPTS = 5; // Max verification attempts per OTP
const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const OTP_RATE_LIMIT_MAX = 5; // Max 5 OTP requests per window per IP

// Rate limiting for OTP requests
const otpRateLimiter = rateLimit({
  windowMs: OTP_RATE_LIMIT_WINDOW_MS,
  max: OTP_RATE_LIMIT_MAX,
  message: 'Too many OTP requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use the built-in IP handling for both IPv4 and IPv6
    return req.ip;
  }
});
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// API key/token middleware
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (process.env.API_KEY && apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  next();
});

// Generate random 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/otp/send - Generate and send OTP via WhatsApp
router.post('/send', otpRateLimiter, async (req, res) => {
  try {
    const { contactNumber, message } = req.body;

    // Validate input
    if (!contactNumber) {
      return res.status(400).json({
        success: false,
        error: 'Contact number is required'
      });
    }

    // Check if contact number is valid (E.164 format with + and country code)
    const cleanedNumber = contactNumber.replace(/\s/g, '');
    if (!/^\+[1-9]\d{1,14}$/.test(cleanedNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Please use international format with country code (e.g., +1234567890)'
      });
    }

    // Atomic operation to find or create OTP with cooldown check
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Find any recent OTP for this number within cooldown period
      const recentOtp = await Otp.findOne({
        contactNumber: cleanedNumber.startsWith('+') ? cleanedNumber : `+${cleanedNumber}`,
        createdAt: { $gt: new Date(Date.now() - OTP_COOLDOWN_MS) }
      }).session(session);

      if (recentOtp) {
        const timeLeft = Math.ceil((recentOtp.createdAt.getTime() + OTP_COOLDOWN_MS - Date.now()) / 1000);
        await session.abortTransaction();
        return res.status(429).json({
          success: false,
          error: `Please wait ${timeLeft} seconds before requesting a new OTP`,
          retryAfter: timeLeft
        });
      }

      // Delete any existing OTPs for this number (using transaction)
      await Otp.deleteMany({ contactNumber: cleanedNumber.startsWith('+') ? cleanedNumber : `+${cleanedNumber}` }).session(session);

      // Generate new OTP
      const uuid = uuidv4();
      const otp = generateOTP();
      const reason = req.body.reason || 'verification';
      const appName = req.body.appName || 'Our Service';
      const companyName = req.body.companyName || 'Our Company';

      const otpRecord = new Otp({
        uuid,
        contactNumber: cleanedNumber.startsWith('+') ? cleanedNumber : `+${cleanedNumber}`,
        otp,
        reason,
        appName,
        attempts: 0,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes expiry
      });

      await otpRecord.save({ session });
      await session.commitTransaction();
      session.endSession();
      
      // Log successful OTP creation
      logger.info({
        event: 'OTPCreated',
        uuid,
        contactNumber: cleanedNumber.startsWith('+') ? cleanedNumber : `+${cleanedNumber}`,
        timestamp: new Date().toISOString()
      });

      // Prepare WhatsApp message with professional formatting
      const formattedOtp = otp.match(/\d{1,3}/g)?.join(' ') || otp;
      
      // Create a professional OTP message with copy button syntax
      const otpMessage = message
        ? message.replace('{otp}', formattedOtp)
        : `🔐 *${appName} Verification Code* 🔐

Your one-time verification code is:

📱 *${formattedOtp}*

_Valid for 5 minutes_

💡 Tap and hold to copy the code

For security reasons, please do not share this code with anyone, including ${companyName} representatives.

Thank you for choosing ${companyName}!`;
      
      // Send OTP via WhatsApp
      const messageId = await whatsappClient.sendMessage(cleanedNumber, otpMessage);

      logger.info({
        event: 'OTPSent',
        uuid,
        contactNumber: cleanedNumber,
        messageId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        uuid,
        contactNumber: cleanedNumber,
        message: 'OTP sent successfully via WhatsApp',
        messageId,
        expiresIn: 300 // 5 minutes in seconds
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error({
        event: 'OTPCreationFailed',
        error: error.message,
        contactNumber: cleanedNumber,
        timestamp: new Date().toISOString()
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to generate OTP. Please try again.'
      });
    }

  } catch (error) {
    logger.error({
      event: 'OTPSendError',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Failed to send OTP',
      details: error.message
    });
  }
});

// GET /api/otp/verify - Verify OTP using uuid, contact number, and OTP
router.get('/verify', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { uuid, contactNumber, otp } = req.query;

    // Validate input
    if (!uuid || !contactNumber || !otp) {
      return res.status(400).json({
        success: false,
        error: 'UUID, contact number, and OTP are required'
      });
    }

    // Clean and format phone number - ensure it has + prefix
    const cleanedNumber = contactNumber.replace(/\s/g, '');
    const formattedNumber = cleanedNumber.startsWith('+') ? cleanedNumber : `+${cleanedNumber}`;

    // Log OTP verification attempt
    logger.info({
      event: 'OTPVerificationAttempt',
      uuid,
      contactNumber: formattedNumber,
      timestamp: new Date().toISOString()
    });

    // Find and lock the OTP record for update
    const otpRecord = await Otp.findOneAndUpdate(
      {
        uuid,
        contactNumber: formattedNumber,
        attempts: { $lt: MAX_OTP_ATTEMPTS },
        createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) } // 5 min expiry
      },
      { $inc: { attempts: 1 } },
      { new: true, session }
    );

    if (!otpRecord) {
      await session.abortTransaction();
      session.endSession();
      
      logger.warn({
        event: 'OTPVerificationFailed',
        reason: 'Invalid or expired OTP',
        uuid,
        contactNumber: formattedNumber,
        timestamp: new Date().toISOString()
      });

      return res.status(400).json({
        success: false,
        error: 'Invalid or expired OTP. Please request a new one.'
      });
    }

    // Check if OTP matches
    if (otpRecord.otp !== otp) {
      await session.abortTransaction();
      session.endSession();
      
      logger.warn({
        event: 'OTPVerificationFailed',
        reason: 'Incorrect OTP',
        uuid,
        contactNumber: formattedNumber,
        attempts: otpRecord.attempts,
        timestamp: new Date().toISOString()
      });

      return res.status(400).json({
        success: false,
        error: 'Incorrect OTP. Please try again.',
        attemptsRemaining: MAX_OTP_ATTEMPTS - otpRecord.attempts
      });
    }

    // Get the verification reason and app name from the OTP record
    const verificationReason = otpRecord.reason || 'verification';
    const appName = otpRecord.appName || 'our service';
    
    // OTP is valid - delete it and commit the transaction
    await Otp.deleteOne({ _id: otpRecord._id }).session(session);
    await session.commitTransaction();
    session.endSession();

    // Send confirmation message
    try {
      const confirmationMessage = `✅ *Verification Successful* ✅\n\nYour ${verificationReason} has been successfully verified.\n\nThank you for using ${appName}!`;
      await whatsappClient.sendMessage(otpRecord.contactNumber, confirmationMessage);
      
      logger.info({
        event: 'VerificationConfirmationSent',
        contactNumber: otpRecord.contactNumber,
        reason: verificationReason,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Log error but don't fail the verification
      logger.error({
        event: 'VerificationConfirmationFailed',
        error: error.message,
        contactNumber: formattedNumber,
        timestamp: new Date().toISOString()
      });
    }

    // Return success response
    return res.json({
      success: true,
      message: 'OTP verified successfully',
      verifiedFor: verificationReason,
      contactNumber: formattedNumber,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Ensure session is properly ended in case of errors
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    
    logger.error({
      event: 'OTPVerificationError',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Failed to verify OTP. Please try again.'
    });
  }
});

// GET /api/otp/status/:uuid - Check OTP status (optional utility endpoint)
router.get('/status/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;

    const otpRecord = await Otp.findOne({ uuid });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        error: 'OTP not found'
      });
    }

    const isExpired = otpRecord.isExpired();
    if (isExpired) {
      await Otp.deleteOne({ _id: otpRecord._id });
    }

    res.json({
      success: true,
      uuid,
      contactNumber: otpRecord.contactNumber,
      isExpired,
      attempts: otpRecord.attempts,
      maxAttempts: 3,
      createdAt: otpRecord.createdAt,
      expiresAt: new Date(otpRecord.createdAt.getTime() + 5 * 60 * 1000)
    });

  } catch (error) {
    logger.error({
      event: 'OTPStatusError',
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get OTP status'
    });
  }
});

module.exports = router;
