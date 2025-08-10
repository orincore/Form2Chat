const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  uuid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  contactNumber: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // OTP expires after 5 minutes (300 seconds)
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3 // Maximum 3 verification attempts
  },
  reason: {
    type: String,
    default: 'verification',
    index: true
  }
});

// Compound indexes for efficient queries
otpSchema.index({ uuid: 1, contactNumber: 1 });
// Index for cooldown check
otpSchema.index({ contactNumber: 1, createdAt: 1 });

// Method to check if OTP is expired
otpSchema.methods.isExpired = function() {
  const now = new Date();
  const expiryTime = new Date(this.createdAt.getTime() + 5 * 60 * 1000); // 5 minutes
  return now > expiryTime;
};

// Method to increment attempts
otpSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

module.exports = mongoose.model('Otp', otpSchema);
