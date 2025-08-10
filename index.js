require('dotenv').config();
const express = require('express');
const cors = require('cors');
const winston = require('winston');
const mongoose = require('mongoose');
const contactRoutes = require('./routes/contact');
const whatsappRoutes = require('./routes/whatsapp');
const otpRoutes = require('./routes/otp');
const { initializeWhatsAppClient } = require('./services/whatsappClient');

const app = express();
const PORT = process.env.PORT || 3000;

// Winston logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    // Add file transport if needed
  ],
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection (optional)
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      logger.info('MongoDB connected');
      // Initialize WhatsApp client after MongoDB connection
      console.log('🔄 Starting WhatsApp client initialization...');
      initializeWhatsAppClient();
    })
    .catch((err) => logger.error('MongoDB connection error:', err));
} else {
  logger.warn('No MONGODB_URI provided, WhatsApp client will not be initialized');
}

// Routes
app.use('/api/contact-form', contactRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/otp', otpRoutes);

// Health check endpoint for pinging
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: 'Server is running' });
});

app.get('/', (req, res) => {
  res.send('Form2WhatsApp Bridge is running.');
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
