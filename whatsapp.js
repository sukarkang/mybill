const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { customerOps, messageOps } = require('./database');

// WhatsApp client instance
let client = null;
let clientStatus = 'disconnected';
let statusCallback = null;
let qrCallback = null;

// Event handlers
const eventHandlers = {
  onReady: () => {
    console.log('✅ WhatsApp is ready!');
    clientStatus = 'ready';
    broadcastStatus();
  },
  
  onAuthenticated: () => {
    console.log('WhatsApp authenticated successfully');
    clientStatus = 'authenticated';
    broadcastStatus();
  },
  
  onAuthenticationFailure: (error) => {
    console.error('WhatsApp authentication failed:', error);
    clientStatus = 'disconnected';
    broadcastStatus();
  },
  
  onQr: (qr) => {
    console.log('QR Code generated');
    clientStatus = 'qr';
    generateQRCodeImage(qr).then(imgData => {
      broadcastQR(imgData);
    });
    broadcastStatus();
  },
  
  onStateChange: (state) => {
    console.log('WhatsApp state changed:', state);
    if (state === 'UNPAIRED' || state === 'LOGGED_OUT') {
      clientStatus = 'disconnected';
      broadcastStatus();
    }
  },
  
  onMessage: async (msg) => {
    console.log('Message received:', msg.from, msg.body.substring(0, 50));
  }
};

// Generate QR code image as base64
async function generateQRCodeImage(qr) {
  try {
    return await qrcode.toDataURL(qr, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
  } catch (error) {
    console.error('QR generation error:', error);
    return null;
  }
}

// Broadcast status to connected clients
function broadcastStatus() {
  if (statusCallback) {
    statusCallback({ status: clientStatus, timestamp: new Date().toISOString() });
  }
}

function broadcastQR(qrData) {
  if (qrCallback) {
    qrCallback(qrData);
  }
}

function setCallbacks(statusCb, qrCb) {
  statusCallback = statusCb;
  qrCallback = qrCb;
}

// Initialize WhatsApp client
function initClient() {
  if (client) {
    client.destroy().then(() => createClient()).catch(console.error);
  } else {
    createClient();
  }
}

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'billing-system',
      dataPath: './session'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    }
  });

  // Attach event handlers
  client.on('ready', eventHandlers.onReady);
  client.on('authenticated', eventHandlers.onAuthenticated);
  client.on('auth_failure', eventHandlers.onAuthenticationFailure);
  client.on('qr', eventHandlers.onQr);
  client.on('state_change', eventHandlers.onStateChange);
  client.on('message', eventHandlers.onMessage);

  // Start the client
  client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
    clientStatus = 'error';
    broadcastStatus();
  });
}

// Start WhatsApp service
async function startService() {
  try {
    console.log('Starting WhatsApp service...');
    clientStatus = 'initializing';
    broadcastStatus();
    
    if (!client) {
      initClient();
    }
    
    return { success: true, message: 'WhatsApp service starting...' };
  } catch (error) {
    console.error('Failed to start WhatsApp service:', error);
    return { success: false, error: error.message };
  }
}

// Stop WhatsApp service
async function stopService() {
  try {
    console.log('Stopping WhatsApp service...');
    
    if (client) {
      await client.destroy();
      client = null;
    }
    
    clientStatus = 'disconnected';
    broadcastStatus();
    
    return { success: true, message: 'WhatsApp service stopped' };
  } catch (error) {
    console.error('Failed to stop WhatsApp service:', error);
    return { success: false, error: error.message };
  }
}

// Get service status
function getStatus() {
  return { status: clientStatus, timestamp: new Date().toISOString() };
}

// Format message with customer data
function formatMessage(template, customer, amount) {
  const period = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  
  return template
    .replace(/\{nama\}/g, customer.nama)
    .replace(/\{jumlah\}/g, parseInt(amount).toLocaleString('id-ID'))
    .replace(/\{tipe\}/g, customer.tipe === 'internet' ? 'Internet/PPPoE' : 'LPG 3kg')
    .replace(/\{tanggal\}/g, today)
    .replace(/\{periode\}/g, period)
    .replace(/\{username\}/g, customer.username_pppoe || '-')
    .replace(/\{password\}/g, customer.password_pppoe || '-');
}

// Send billing message to single customer
async function sendBillingMessage(customerId, message, userId = null) {
  try {
    if (!client || clientStatus !== 'ready') {
      throw new Error('WhatsApp client not ready');
    }

    const customer = customerOps.getById(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    const phone = customer.whatsapp.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('0') ? '62' + phone.substring(1) : phone;
    const chatId = `${formattedPhone}@c.us`;

    // Send message
    await client.sendMessage(chatId, message);
    
    // Log success
    messageOps.create({
      customer_id: customerId,
      customer_nama: customer.nama,
      phone: formattedPhone,
      message_type: 'billing',
      status: 'success',
      message_preview: message.substring(0, 200),
      sent_by: userId
    });

    console.log(`✅ Message sent to ${customer.nama} (${formattedPhone})`);
    return { success: true, customer: customer.nama, phone: formattedPhone };

  } catch (error) {
    console.error('Failed to send message:', error);
    
    // Log failure
    messageOps.create({
      customer_id: customerId,
      customer_nama: customer?.nama,
      phone: null,
      message_type: 'billing',
      status: 'failed',
      message_preview: message?.substring(0, 200),
      error_message: error.message,
      sent_by: userId
    });

    return { success: false, error: error.message };
  }
}

// Broadcast billing message to all customers with pending bills
async function broadcastBillingMessage(template, userId = null) {
  const results = { total: 0, success: 0, failed: 0, details: [] };

  try {
    const debtors = customerOps.getWithPending();
    console.log(`Found ${debtors.length} customers with pending bills`);

    for (const customer of debtors) {
      results.total++;
      
      // Format message for this customer
      const message = formatMessage(template, customer, customer.total_debt);
      
      // Send message
      const sendResult = await sendBillingMessage(customer.id, message, userId);
      
      if (sendResult.success) {
        results.success++;
      } else {
        results.failed++;
      }
      
      results.details.push({
        customer: customer.nama,
        status: sendResult.success ? 'success' : 'failed',
        error: sendResult.error || null
      });

      // Delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return {
      success: true,
      message: `Broadcast completed: ${results.success} sent, ${results.failed} failed`,
      summary: results
    };

  } catch (error) {
    console.error('Broadcast failed:', error);
    return { success: false, error: error.message };
  }
}

// Get message logs
function getMessageLogs(limit = 50) {
  return messageOps.getRecent(limit);
}

// Get message stats
function getMessageStats() {
  return messageOps.getStats();
}

module.exports = {
  startService,
  stopService,
  getStatus,
  sendBillingMessage,
  broadcastBillingMessage,
  getMessageLogs,
  getMessageStats,
  setCallbacks,
  initClient
};
