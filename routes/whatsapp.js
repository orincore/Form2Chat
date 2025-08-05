const express = require('express');
const router = express.Router();
const whatsappClient = require('../services/whatsappClient');
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

// Get WhatsApp client status
router.get('/status', (req, res) => {
  try {
    const status = whatsappClient.getClientStatus();
    logger.info({ event: 'StatusRequested', status });
    res.json({
      success: true,
      status: {
        isReady: status.isReady,
        state: status.state,
        authenticated: !!status.info,
        info: status.info ? {
          wid: status.info.wid,
          pushname: status.info.pushname,
          platform: status.info.platform
        } : null
      }
    });
  } catch (error) {
    logger.error({ event: 'StatusError', error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get client status' });
  }
});

// Generate QR code for authentication
router.post('/generate-qr', async (req, res) => {
  try {
    logger.info({ event: 'QRGenerationRequested' });
    await whatsappClient.generateQRCode();
    res.json({ 
      success: true, 
      message: 'QR code generation initiated. Check console for QR code.',
      note: 'Scan the QR code displayed in the server console with your WhatsApp mobile app.'
    });
  } catch (error) {
    logger.error({ event: 'QRGenerationError', error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// Restart WhatsApp client
router.post('/restart', async (req, res) => {
  try {
    logger.info({ event: 'ClientRestartRequested' });
    await whatsappClient.restartClient();
    res.json({ 
      success: true, 
      message: 'WhatsApp client restart initiated.'
    });
  } catch (error) {
    logger.error({ event: 'ClientRestartError', error: error.message });
    res.status(500).json({ success: false, error: 'Failed to restart client' });
  }
});

module.exports = router;
