const express = require('express');
const router = express.Router();
const { handleContactForm } = require('../controllers/messageController');

// API key/token middleware
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (process.env.API_KEY && apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  next();
});

router.post('/', handleContactForm);

module.exports = router;
