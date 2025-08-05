const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  message: String,
  customerMsgId: String,
  adminMsgId: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Submission', submissionSchema); 