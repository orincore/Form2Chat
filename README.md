# WhatsApp Web Bridge API

A robust Node.js application that bridges web forms to WhatsApp messages using the whatsapp-web.js library.

**Created by:** [ORINCORE](https://github.com/orincore) (Adarsh Suradkar)

## Features

- ✅ Send WhatsApp messages via REST API
- ✅ QR code authentication management
- ✅ Client status monitoring and control
- ✅ MongoDB integration for message logging
- ✅ Comprehensive error handling and retry logic
- ✅ API key authentication
- ✅ Winston logging with structured logs

## Recent Fixes & Improvements

### Message Sending Fixes
- **Enhanced client readiness checks**: Validates both authentication and connection state
- **Improved phone number validation**: Handles various phone number formats
- **Better error handling**: Specific error types with appropriate retry logic
- **Message content validation**: Ensures valid message content before sending
- **Retry mechanism**: Intelligent retry with exponential backoff for transient errors
- **Client recovery**: Automatic page refresh and client reinitialization on errors

### QR Code Management Fixes
- **New API endpoints**: `/api/whatsapp/status`, `/api/whatsapp/generate-qr`, `/api/whatsapp/restart`
- **Client restart functionality**: Ability to restart WhatsApp client programmatically
- **Better QR code generation**: Handles existing connections properly
- **Status monitoring**: Real-time client status with detailed information

### General Improvements
- **Fixed MongoDB warnings**: Removed deprecated connection options
- **Enhanced logging**: Structured logging with event tracking
- **Better API responses**: Detailed success/failure information
- **Improved validation**: Comprehensive input validation for all endpoints
- **Error categorization**: Specific HTTP status codes for different error types

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```
4. Update `.env` with your configuration:
   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=production
   
   # WhatsApp Configuration
   ADMIN_NUMBER=+911234567890
   
   # API Security
   API_KEY=your_secure_api_key_here_123456
   
   # Database (Optional)
   MONGODB_URI=
   ```

### Environment Variables Explained

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port number | `3000` | No |
| `NODE_ENV` | Environment mode | `production` or `development` | No |
| `ADMIN_NUMBER` | WhatsApp number to receive admin notifications (with country code) | `+919876543210` | Yes |
| `API_KEY` | Secure API key for endpoint authentication | `your_secure_api_key_here_123456` | Yes |
| `MONGODB_URI` | MongoDB connection string for data persistence | `mongodb+srv://user:pass@cluster.mongodb.net/db` | No |

## Usage

### Starting the Server

```bash
# Production
npm start

# Development (with nodemon)
npm run dev
```

### API Endpoints

#### Contact Form Submission
```http
POST /api/contact-form
Content-Type: application/json
X-API-Key: your_api_key

{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "message": "Hello, I need help with..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Contact form processed successfully.",
  "details": {
    "customerMessageSent": true,
    "adminMessageSent": true,
    "savedToDatabase": true,
    "customerMessageId": "message_id_1",
    "adminMessageId": "message_id_2",
    "submissionId": "mongodb_document_id"
  }
}
```

#### WhatsApp Client Status
```http
GET /api/whatsapp/status
X-API-Key: your_api_key
```

**Response:**
```json
{
  "success": true,
  "status": {
    "isReady": true,
    "state": "CONNECTED",
    "authenticated": true,
    "info": {
      "wid": "1234567890@c.us",
      "pushname": "Your Name",
      "platform": "android"
    }
  }
}
```

#### Generate QR Code
```http
POST /api/whatsapp/generate-qr
X-API-Key: your_api_key
```

#### Restart WhatsApp Client
```http
POST /api/whatsapp/restart
X-API-Key: your_api_key
```

## Authentication Setup

1. Start the server: `npm start`
2. Check the console for QR code output
3. Open WhatsApp on your phone
4. Go to Settings > Linked Devices
5. Tap "Link a Device"
6. Scan the QR code displayed in the console
7. Wait for "WhatsApp client is ready!" message

## Error Handling

The application includes comprehensive error handling:

- **400 Bad Request**: Invalid input data
- **401 Unauthorized**: Invalid or missing API key
- **500 Internal Server Error**: Server configuration issues
- **503 Service Unavailable**: WhatsApp client not ready
- **504 Gateway Timeout**: Message sending timeout

## Logging

All events are logged with Winston:
- Console output for development
- Structured JSON logs for production
- Event tracking for debugging

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `ADMIN_NUMBER` | WhatsApp number to receive admin messages | Yes |
| `API_KEY` | API key for authentication | Yes |
| `MONGODB_URI` | MongoDB connection string | No |
| `NODE_ENV` | Environment (development/production) | No |

## Troubleshooting

### WhatsApp Client Issues
1. Check client status: `GET /api/whatsapp/status`
2. Generate new QR code: `POST /api/whatsapp/generate-qr`
3. Restart client: `POST /api/whatsapp/restart`

### Message Sending Failures
- Verify phone number format (digits only, no spaces/dashes)
- Check WhatsApp client authentication status
- Review server logs for specific error details
- Ensure recipient has WhatsApp installed

### Common Error Messages
- `"WhatsApp client is not authenticated"`: Scan QR code
- `"Invalid phone number provided"`: Check phone number format
- `"Message send timeout"`: Network or WhatsApp service issues
- `"Failed to send message after 3 attempts"`: Persistent connection issues

## Development

### Project Structure
```
├── controllers/        # Request handlers
├── models/            # MongoDB schemas
├── routes/            # API route definitions
├── services/          # WhatsApp client service
├── utils/             # Message templates and utilities
├── .wwebjs_auth/      # WhatsApp authentication data
├── .wwebjs_cache/     # WhatsApp cache data
└── index.js           # Main application entry point
```

### Adding New Features
1. Create new routes in `routes/`
2. Add controllers in `controllers/`
3. Update service logic in `services/`
4. Add proper error handling and logging
5. Update this README

## License

ISC License

## Support

For issues and questions:
1. Check the server logs for detailed error information
2. Verify environment configuration
3. Test WhatsApp client status via API endpoints
4. Review this documentation for troubleshooting steps
