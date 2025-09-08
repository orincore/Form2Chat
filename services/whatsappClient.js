const { Client, LocalAuth } = require('whatsapp-web.js');
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
let readyReceived = false;
let ensuringReady = false;

// Function to initialize WhatsApp client (called after MongoDB connects)
function initializeWhatsAppClient() {
  if (client) {
    console.log('⚠️  WhatsApp client already initialized');
    return client;
  }

  console.log('🔄 Initializing WhatsApp client with local session store...');
  
  // Create WhatsApp client with LocalAuth strategy (more reliable)
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'wa-web-client',
      dataPath: './.wwebjs_auth/'
    }),
    // Disable web version caching to avoid stale/broken WA Web bundles
    webVersionCache: {
      type: 'none'
    },
    puppeteer: {
      headless: 'new',
      timeout: 60000,
      defaultViewport: null,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=site-per-process,IsolateOrigins,site-per-process',
        '--no-zygote'
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
    readyReceived = true;
    
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
    console.log('💾 Session will be saved automatically by LocalAuth...');
    console.log('⏳ Please wait ~1 minute for session to be fully written locally.');
    
    // LocalAuth automatically saves sessions, no manual intervention needed
    console.log('📁 Session will be saved locally in .wwebjs_auth/ directory');
    
    // Start readiness watchdog in case ready event doesn't fire
    setTimeout(async () => {
      if (!client.info && !readyReceived) {
        console.log('⚠️  Ready event not received after authentication. Attempting to force ready state...');
        logger.warn({ 
          event: 'ReadyEventDelayed', 
          state: client.state,
          hasInfo: !!client.info 
        });
        
        // Try to force the client to get info
        await ensureReady(90000).catch(() => {});
      }
    }, 30000); // 30 seconds timeout
  });

  // LocalAuth doesn't use remote_session_saved event, sessions are saved automatically

  // Add session loading event
  client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading WhatsApp: ${percent}% - ${message}`);
  });

  // Log state changes for better diagnostics
  client.on('change_state', (state) => {
    console.log(`🔁 WhatsApp state changed: ${state}`);
    logger.info({ event: 'ChangeState', state });
  });

  // Add debug logging for session restore with LocalAuth
  console.log('🔍 Checking for existing local session...');
  const fs = require('fs');
  const path = require('path');
  const sessionPath = path.join('./.wwebjs_auth/', 'session-wa-web-client');
  
  if (fs.existsSync(sessionPath)) {
    console.log('✅ Found existing local session - will attempt to restore');
  } else {
    console.log('⚠️  No existing session found - QR code will be required');
  }

  // After initialization, attempt to ensure ready state in background
  (async () => {
    try {
      await ensureReady(120000); // wait up to 2 minutes on cold start
    } catch (e) {
      // Already logged inside ensureReady
    }
  })();

  client.on('auth_failure', (msg) => {
    logger.error({ event: 'AuthFailure', message: msg });
    console.log('❌ WhatsApp authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    logger.warn({ event: 'WhatsAppDisconnected', reason });
    console.log('⚠️  WhatsApp disconnected:', reason);
    readyReceived = false;
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
      // Determine readiness based on connection state or presence of info
      let currentState = client.state;
      if (!client.info && currentState !== 'CONNECTED') {
        try {
          await client.getState(); // may update internal state
          currentState = client.state;
        } catch (_) {
          // ignore, we'll validate below
        }
      }

      if (!client.info && currentState !== 'CONNECTED') {
        throw new Error(`WhatsApp client is not ready. Current state: ${currentState || 'unknown'}`);
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

  const state = client.state || 'UNKNOWN';
  const hasInfo = !!client.info;
  return {
    isReady: hasInfo || state === 'CONNECTED',
    state,
    info: client.info || null
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
    if (client && client.state !== 'UNPAIRED') {
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

// Polls for CONNECTED state; reloads page midway; reinitializes as last resort
async function ensureReady(maxWaitMs = 60000) {
  const start = Date.now();
  let reloaded = false;
  while (Date.now() - start < maxWaitMs) {
    // Exit early if already ready
    if (readyReceived || client.info) {
      console.log('✅ ensureReady: Client already ready, exiting watchdog.');
      return;
    }

    let state = client.state;
    try {
      await client.getState();
      state = client.state || state;
    } catch (_) {}

    if (state === 'CONNECTED') {
      console.log('✅ WhatsApp connection state is CONNECTED.');
      return;
    }

    // Midway, try a page reload to kick the session
    const elapsed = Date.now() - start;
    if (!reloaded && elapsed > maxWaitMs / 2) {
      if (readyReceived || client.info) {
        console.log('✅ ensureReady: Ready during watchdog, skip reload.');
        return;
      }
      try {
        console.log('🔄 Reloading WhatsApp page to recover readiness...');
        if (client.pupPage && !client.pupPage.isClosed()) {
          await client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
        }
        reloaded = true;
      } catch (err) {
        console.log('❌ Page reload failed:', err.message);
        logger.error({ event: 'PageReloadFailed', error: err.message });
      }
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  // As a last resort, reinitialize the client (LocalAuth will reuse session)
  try {
    // Double-check before reinitializing
    if (readyReceived || client.info || client.state === 'CONNECTED') {
      console.log('✅ ensureReady: Client became ready before reinit, skipping.');
      return;
    }
    console.log('♻️  Reinitializing WhatsApp client to recover readiness...');
    await client.destroy();
    await new Promise(r => setTimeout(r, 2000));
    await client.initialize();
    logger.warn({ event: 'ClientReinitializedAfterTimeout' });
  } catch (e) {
    console.log('❌ Failed to reinitialize client:', e.message);
    logger.error({ event: 'ClientReinitFailed', error: e.message });
  }
}
