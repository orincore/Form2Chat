const whatsappClient = require('../services/whatsappClient');
const { customerTemplate, adminTemplate } = require('../utils/messageTemplates');
const winston = require('winston');
let Submission;
try {
  Submission = require('../models/Submission');
} catch (e) {}

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

exports.handleContactForm = async (req, res) => {
  const formData = req.body;
  const adminNumber = process.env.ADMIN_NUMBER;
  const customerNumber = formData.phone;
  let customerMsgId, adminMsgId, dbEntry;

  try {
    // Validate required fields
    if (!formData.name || !formData.email || !formData.phone || !formData.message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: name, email, phone, and message are required.' 
      });
    }

    // Validate admin number is configured
    if (!adminNumber) {
      logger.error({ event: 'AdminNumberMissing' });
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error: Admin number not configured.' 
      });
    }

    // Check WhatsApp client status before attempting to send
    const clientStatus = whatsappClient.getClientStatus();
    if (!clientStatus.isReady) {
      logger.error({ event: 'WhatsAppNotReady', status: clientStatus });
      return res.status(503).json({ 
        success: false, 
        error: 'WhatsApp service is not ready. Please try again later or contact support.',
        details: `Client state: ${clientStatus.state}` 
      });
    }

    logger.info({ event: 'ProcessingContactForm', formData: { ...formData, message: '[REDACTED]' } });

    // Send message to customer
    const customerMsg = customerTemplate(formData);
    try {
      customerMsgId = await whatsappClient.sendMessage(customerNumber, customerMsg);
      logger.info({ event: 'CustomerMessageSent', to: customerNumber, messageId: customerMsgId });
    } catch (customerError) {
      logger.error({ event: 'CustomerMessageFailed', to: customerNumber, error: customerError.message });
      // Continue to try admin message even if customer message fails
    }

    // Send message to admin
    const adminMsg = adminTemplate(formData);
    try {
      adminMsgId = await whatsappClient.sendMessage(adminNumber, adminMsg);
      logger.info({ event: 'AdminMessageSent', to: adminNumber, messageId: adminMsgId });
    } catch (adminError) {
      logger.error({ event: 'AdminMessageFailed', to: adminNumber, error: adminError.message });
      // If both messages fail, throw error
      if (!customerMsgId) {
        throw new Error('Failed to send messages to both customer and admin');
      }
    }

    // Check if at least one message was sent successfully
    if (!customerMsgId && !adminMsgId) {
      throw new Error('Failed to send any messages');
    }

    // Optionally save to MongoDB
    if (Submission) {
      try {
        dbEntry = await Submission.create({ 
          ...formData, 
          customerMsgId: customerMsgId || null, 
          adminMsgId: adminMsgId || null,
          status: customerMsgId && adminMsgId ? 'both_sent' : 
                  customerMsgId ? 'customer_only' : 'admin_only'
        });
        logger.info({ event: 'SubmissionSaved', id: dbEntry._id, status: dbEntry.status });
      } catch (dbError) {
        logger.error({ event: 'DatabaseSaveError', error: dbError.message });
        // Don't fail the request if DB save fails, messages were sent
      }
    }

    // Prepare response based on what was sent successfully
    const response = {
      success: true,
      message: 'Contact form processed successfully.',
      details: {
        customerMessageSent: !!customerMsgId,
        adminMessageSent: !!adminMsgId,
        savedToDatabase: !!dbEntry
      }
    };

    if (customerMsgId) response.details.customerMessageId = customerMsgId;
    if (adminMsgId) response.details.adminMessageId = adminMsgId;
    if (dbEntry) response.details.submissionId = dbEntry._id;

    res.status(200).json(response);

  } catch (error) {
    logger.error({ 
      event: 'ContactFormProcessingError', 
      error: error.message, 
      stack: error.stack,
      formData: { ...formData, message: '[REDACTED]' } 
    });
    
    // Determine appropriate error response
    let statusCode = 500;
    let errorMessage = 'Failed to process contact form.';
    
    if (error.message.includes('not authenticated') || error.message.includes('not ready')) {
      statusCode = 503;
      errorMessage = 'WhatsApp service is temporarily unavailable. Please try again later.';
    } else if (error.message.includes('Invalid phone number')) {
      statusCode = 400;
      errorMessage = 'Invalid phone number format provided.';
    } else if (error.message.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'Request timeout. Please try again.';
    }
    
    res.status(statusCode).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
