const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const winston = require('winston');
const qrcode = require('qrcode-terminal');

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

// WhatsApp client and store variables
let client = null;
let store = null;

// Function to initialize WhatsApp client (called after MongoDB connects)
function initializeWhatsAppClient() {
  if (client) {
    console.log('⚠️  WhatsApp client already initialized');
    return client;
  }

  console.log('🔄 Initializing WhatsApp client with MongoDB session store...');
  
  // Create MongoDB store for session management
  store = new MongoStore({ mongoose: mongoose });

  // Create WhatsApp client with RemoteAuth strategy
  client = new Client({
    authStrategy: new RemoteAuth({
      clientId: 'wa-web-client', // Unique identifier for this session
      store: store,
      backupSyncIntervalMs: 300000 // 5 minutes backup sync
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000
  });

  client.on('qr', (qr) => {
    logger.info({ event: 'QRGenerated', message: 'Scan this QR code with WhatsApp.' });
    console.log('\n🔐 WHATSAPP AUTHENTICATION REQUIRED');
    console.log('=====================================');
    console.log('Please scan the QR code below with your WhatsApp mobile app:');
    console.log('1. Open WhatsApp on your phone');
    console.log('2. Go to Settings > Linked Devices');
    console.log('3. Tap "Link a Device"');
    console.log('4. Scan the QR code below:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⏳ Waiting for QR code scan...\n');
  });

  client.on('ready', () => {
    logger.info({ event: 'WhatsAppReady', message: 'WhatsApp client is ready.' });
    console.log('✅ WhatsApp client is ready and authenticated!');
    console.log('📱 You can now send messages through the API.\n');
    
    // Log client info for debugging
    console.log('🔍 Client Info:', {
      state: client.state,
      hasInfo: !!client.info,
      wid: client.info?.wid
    });
  });

  client.on('authenticated', (session) => {
    logger.info({ event: 'WhatsAppAuthenticated', message: 'WhatsApp authentication successful.' });
    console.log('✅ WhatsApp authentication successful!');
    console.log('💾 Session will be saved to MongoDB automatically...');
    console.log('⏳ Please wait ~1 minute for session to be fully saved to MongoDB.');
    
    // Add a timeout to check if ready event fires within reasonable time
    setTimeout(async () => {
      if (!client.info) {
        console.log('⚠️  Ready event not received after authentication. Attempting to force ready state...');
        logger.warn({ 
          event: 'ReadyEventDelayed', 
          state: client.state,
          hasInfo: !!client.info 
        });
        
        // Try to force the client to get info
        try {
          console.log('🔄 Attempting to retrieve client info manually...');
          await client.getState();
          
          // Check if we now have info after getState()
          if (client.info) {
            console.log('✅ Client info retrieved successfully after manual check!');
            logger.info({ event: 'ClientInfoRetrieved', wid: client.info.wid });
          } else {
            console.log('❌ Still no client info available. May need to re-authenticate.');
            logger.error({ event: 'ClientInfoUnavailable' });
          }
        } catch (error) {
          console.log('❌ Failed to retrieve client state:', error.message);
          logger.error({ event: 'ClientStateRetrievalFailed', error: error.message });
        }
      }
    }, 30000); // 30 seconds timeout
  });

  // Listen for remote session saved event
  client.on('remote_session_saved', () => {
    logger.info({ event: 'RemoteSessionSaved', message: 'WhatsApp session saved to MongoDB.' });
    console.log('✅ WhatsApp session successfully saved to MongoDB!');
    console.log('🔄 Session backups will sync every 5 minutes.');
    console.log('🚀 Server restarts will now restore this session automatically!');
    
    // Sometimes the ready event doesn't fire but session is saved - check if we can get info now
    setTimeout(async () => {
      if (!client.info) {
        try {
          console.log('🔄 Checking client info after session save...');
          await client.getState();
          if (client.info) {
            console.log('✅ Client is now ready after session save!');
            logger.info({ event: 'ClientReadyAfterSessionSave', wid: client.info.wid });
          }
        } catch (error) {
          logger.error({ event: 'PostSessionSaveCheckFailed', error: error.message });
        }
      }
    }, 5000);
  });

  // Add session loading event
  client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading WhatsApp: ${percent}% - ${message}`);
  });

  // Add debug logging for session restore
  console.log('🔍 Checking for existing session in MongoDB...');
  store.sessionExists({ session: 'wa-web-client' })
    .then(exists => {
      if (exists) {
        console.log('✅ Found existing session in MongoDB - will attempt to restore');
      } else {
        console.log('⚠️  No existing session found - QR code will be required');
      }
    })
    .catch(err => {
      console.log('❌ Error checking session:', err.message);
    });

  client.on('auth_failure', (msg) => {
    logger.error({ event: 'AuthFailure', message: msg });
    console.log('❌ WhatsApp authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    logger.warn({ event: 'WhatsAppDisconnected', reason });
    console.log('⚠️  WhatsApp disconnected:', reason);
  });

  // Initialize the client
  client.initialize().catch((error) => {
    logger.error({ event: 'InitializationFailed', error: error.message });
  });
  
  return client;
}

// Export the initialization function to be called after MongoDB connects
module.exports.initializeWhatsAppClient = initializeWhatsAppClient;

async function sendMessage(number, message) {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Enhanced client readiness check with fallback
      let isClientReady = client.info && (client.state === 'CONNECTED' || client.state === undefined);
      
      // If client.info is not available but we might be authenticated, try to get state
      if (!client.info && client.state !== 'UNPAIRED') {
        try {
          await client.getState();
          isClientReady = !!client.info;
        } catch (error) {
          // If getState fails, we're definitely not ready
          isClientReady = false;
        }
      }
      
      if (!isClientReady) {
        const statusMsg = !client.info ? 
          'WhatsApp client is not authenticated. Please scan the QR code first.' :
          `WhatsApp client is not ready. Current state: ${client.state || 'unknown'}`;
        throw new Error(statusMsg);
      }

      // Validate phone number format
      if (!number || typeof number !== 'string') {
        throw new Error('Invalid phone number provided');
      }

      // Format phone number - ensure it's properly formatted
      let chatId = number.trim();
      if (!chatId.includes('@c.us')) {
        // Remove any non-digit characters except +
        chatId = chatId.replace(/[^+\d]/g, '');
        // Remove leading + if present
        if (chatId.startsWith('+')) {
          chatId = chatId.substring(1);
        }
        chatId = `${chatId}@c.us`;
      }
      
      logger.info({ event: 'SendingMessage', number, chatId, message, attempt: retryCount + 1 });
      
      // Validate message content
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Invalid message content provided');
      }
      
      // Try to send message with timeout
      const sentMsg = await Promise.race([
        client.sendMessage(chatId, message.trim()),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Message send timeout after 15 seconds')), 15000)
        )
      ]);
      
      if (!sentMsg || !sentMsg.id) {
        throw new Error('Message sent but no confirmation received');
      }
      
      logger.info({ event: 'MessageSentSuccessfully', number, messageId: sentMsg.id._serialized });
      return sentMsg.id._serialized;
      
    } catch (error) {
      retryCount++;
      logger.error({ 
        event: 'SendMessageError', 
        error: error.message, 
        number,
        attempt: retryCount,
        maxRetries,
        clientState: client.state,
        clientInfo: !!client.info
      });
      
      // Handle specific error types
      if (error.message.includes('Evaluation failed') || 
          error.message.includes('Protocol error') ||
          error.message.includes('Target closed')) {
        
        if (retryCount < maxRetries) {
          logger.info({ event: 'RecoveringFromClientError', attempt: retryCount, errorType: 'evaluation_failed' });
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 5000 * retryCount));
          
          // Try to refresh the page or reinitialize if needed
          try {
            if (client.pupPage && !client.pupPage.isClosed()) {
              await client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
              await new Promise(resolve => setTimeout(resolve, 8000));
            }
          } catch (refreshError) {
            logger.error({ event: 'PageRefreshFailed', error: refreshError.message });
            // If page refresh fails, try to reinitialize the client
            try {
              await client.initialize();
              await new Promise(resolve => setTimeout(resolve, 10000));
            } catch (initError) {
              logger.error({ event: 'ClientReinitializationFailed', error: initError.message });
            }
          }
          
          continue; // Try again
        }
      }
      
      // If we've exhausted retries or it's not a retryable error
      if (retryCount >= maxRetries) {
        throw new Error(`Failed to send message after ${maxRetries} attempts: ${error.message}`);
      }
      
      // For non-retryable errors, fail immediately
      if (error.message.includes('Invalid phone number') || 
          error.message.includes('Invalid message content') ||
          error.message.includes('not authenticated')) {
        throw error;
      }
      
      // Wait before next retry for other errors
      await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
    }
  }
}

function getClientStatus() {
  if (!client) {
    return {
      isReady: false,
      state: 'NOT_INITIALIZED',
      info: null
    };
  }

  const hasInfo = !!client.info;
  const state = client.state || (hasInfo ? 'CONNECTED' : 'UNPAIRED');
  
  return {
    isReady: hasInfo && (state === 'CONNECTED' || state === 'OPENING' || client.state === undefined),
    state: state,
    info: client.info
  };
}

async function generateQRCode() {
  if (!client.info) {
    console.log('🔄 Generating QR code for WhatsApp authentication...');
    try {
      if (client.state === 'CONNECTED' || client.state === 'OPENING') {
        await client.destroy();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      await client.initialize();
    } catch (error) {
      console.log('❌ Failed to generate QR code:', error.message);
      logger.error({ event: 'QRGenerationFailed', error: error.message });
      throw error;
    }
  } else {
    console.log('✅ WhatsApp client is already authenticated');
  }
}

async function restartClient() {
  try {
    logger.info({ event: 'ClientRestartInitiated' });
    console.log('🔄 Restarting WhatsApp client...');
    
    // Destroy existing client
    if (client.state !== 'UNPAIRED') {
      await client.destroy();
    }
    
    // Wait a moment before reinitializing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Reinitialize client
    await client.initialize();
    
    logger.info({ event: 'ClientRestartCompleted' });
    console.log('✅ WhatsApp client restarted successfully');
  } catch (error) {
    logger.error({ event: 'ClientRestartFailed', error: error.message });
    console.log('❌ Failed to restart WhatsApp client:', error.message);
    throw error;
  }
}

module.exports = { 
  client, 
  sendMessage, 
  getClientStatus, 
  generateQRCode,
  restartClient,
  initializeWhatsAppClient
};
