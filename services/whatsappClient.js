const { Client, LocalAuth } = require('whatsapp-web.js');
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

// Simple, stable client configuration
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'wa-web-client',
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript-harmony-shipping',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-experiments',
      '--no-pings',
      '--single-process',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-client-side-phishing-detection',
      '--disable-component-extensions-with-background-pages',
      '--disable-breakpad',
      '--disable-features=Translate,BackForwardCache,AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--enable-automation',
      '--password-store=basic',
      '--use-mock-keychain',
      '--enable-blink-features=IdleDetection',
      '--export-tagged-pdf',
      '--user-data-dir=./.wwebjs_auth/session'
    ],
    timeout: 60000,
    protocolTimeout: 60000,
    defaultViewport: null
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
});

client.on('authenticated', () => {
  logger.info({ event: 'WhatsAppAuthenticated', message: 'WhatsApp authentication successful.' });
  console.log('✅ WhatsApp authentication successful!');
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

async function sendMessage(number, message) {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Enhanced client readiness check
      const isClientReady = client.info && (client.state === 'CONNECTED' || client.state === undefined);
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
  const hasInfo = !!client.info;
  const state = client.state || (hasInfo ? 'CONNECTED' : 'UNPAIRED');
  
  return {
    isReady: hasInfo && (state === 'CONNECTED' || client.state === undefined),
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
  restartClient 
};
