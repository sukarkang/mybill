const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');

// Import modules
const { userOps, customerOps, transactionOps, settingsOps } = require('./database');
const whatsapp = require('./whatsapp');

const app = express();
const server = http.createServer(app);

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'pppoe_billing_secret_key_2024';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients for real-time updates (SSE)
const clients = new Set();

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  // Add to clients set
  clients.add(res);
  
  // Send WhatsApp status
  const waStatus = whatsapp.getStatus();
  res.write(`data: ${JSON.stringify({ type: 'wa_status', data: waStatus })}\n\n`);
  
  // Cleanup on close
  req.on('close', () => {
    clients.delete(res);
  });
});

// Broadcast to all connected clients
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    client.write(message);
  });
}

// Set WhatsApp callbacks for real-time updates
whatsapp.setCallbacks(
  (status) => broadcast({ type: 'wa_status', data: status }),
  (qrData) => broadcast({ type: 'wa_qr', data: qrData })
);

// ==================== AUTHENTICATION ====================

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = userOps.getByUsername(username);
  
  if (!user) {
    return res.status(401).json({ success: false, error: 'Username tidak ditemukan' });
  }
  
  if (!user.aktif) {
    return res.status(401).json({ success: false, error: 'Akun tidak aktif' });
  }
  
  if (!userOps.verifyPassword(user, password)) {
    return res.status(401).json({ success: false, error: 'Password salah' });
  }
  
  // Generate token
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  userOps.logActivity(user.id, 'LOGIN', 'User login ke sistem');
  
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      nama_lengkap: user.nama_lengkap,
      role: user.role
    }
  });
});

// Verify token
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token tidak ditemukan' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = userOps.getById(decoded.id);
    
    if (!user || !user.aktif) {
      return res.status(401).json({ success: false, error: 'User tidak valid' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        role: user.role
      }
    });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Token expired' });
  }
});

// ==================== MIDDLEWARE ====================

// Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token diperlukan' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Token tidak valid' });
  }
};

// Verify admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Akses ditolak. Hanya admin yang dapat mengakses.' });
  }
  next();
};

// ==================== USERS API (Admin Only) ====================

app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = userOps.getAll();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { username, password, nama_lengkap, role } = req.body;
    
    if (!username || !password || !nama_lengkap) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }
    
    // Check if username exists
    if (userOps.getByUsername(username)) {
      return res.status(400).json({ success: false, error: 'Username sudah digunakan' });
    }
    
    const user = userOps.create({ username, password, nama_lengkap, role });
    userOps.logActivity(req.user.id, 'CREATE_USER', `Menambah user: ${username}`);
    
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { nama_lengkap, role, aktif, password } = req.body;
    const user = userOps.update(req.params.id, { nama_lengkap, role, aktif, password });
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    
    userOps.logActivity(req.user.id, 'UPDATE_USER', `Update user: ${user.username}`);
    
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    if (req.params.id == req.user.id) {
      return res.status(400).json({ success: false, error: 'Tidak dapat menghapus diri sendiri' });
    }
    
    const targetUser = userOps.getById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    userOps.logActivity(req.user.id, 'DELETE_USER', `Hapus user: ${targetUser.username}`);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== CUSTOMERS API ====================

app.get('/api/customers', authenticateToken, (req, res) => {
  try {
    const { tipe, search } = req.query;
    const customers = customerOps.getAll({ tipe, search: search || undefined });
    res.json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/customers/with-pending/debt', authenticateToken, (req, res) => {
  try {
    const customers = customerOps.getWithPending();
    res.json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/customers/:id', authenticateToken, (req, res) => {
  try {
    const customer = customerOps.getById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan' });
    }
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/customers', authenticateToken, (req, res) => {
  try {
    const { nama, tipe, whatsapp, username_pppoe, password_pppoe, alamat } = req.body;
    
    if (!nama || !tipe || !whatsapp) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }
    
    const customer = customerOps.create({ nama, tipe, whatsapp, username_pppoe, password_pppoe, alamat }, req.user.id);
    broadcast({ type: 'customer_updated', data: customer });
    
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/customers/:id', authenticateToken, (req, res) => {
  try {
    const { nama, tipe, whatsapp, username_pppoe, password_pppoe, alamat } = req.body;
    const customer = customerOps.update(req.params.id, { nama, tipe, whatsapp, username_pppoe, password_pppoe, alamat }, req.user.id);
    
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan' });
    }
    
    broadcast({ type: 'customer_updated', data: customer });
    
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/customers/:id', authenticateToken, (req, res) => {
  try {
    const result = customerOps.delete(req.params.id, req.user.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan' });
    }
    
    broadcast({ type: 'customer_updated' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TRANSACTIONS API ====================

app.get('/api/transactions', authenticateToken, (req, res) => {
  try {
    const { status, jenis, customer_id, limit } = req.query;
    const transactions = transactionOps.getAll({ status, jenis, customer_id, limit: limit ? parseInt(limit) : undefined });
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/transactions/stats', authenticateToken, (req, res) => {
  try {
    const stats = transactionOps.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/transactions/monthly', authenticateToken, (req, res) => {
  try {
    const data = transactionOps.getMonthlyData();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/transactions/customer/:id/pending', authenticateToken, (req, res) => {
  try {
    const transactions = transactionOps.getPendingByCustomer(req.params.id);
    const total = transactions.reduce((sum, t) => sum + t.jumlah, 0);
    res.json({ success: true, data: transactions, total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/transactions', authenticateToken, (req, res) => {
  try {
    const { customer_id, customer_nama, customer_tipe, kategori, jumlah, jenis, status, deskripsi } = req.body;
    
    if (!customer_id || !kategori || !jumlah || !jenis) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }
    
    const transaction = transactionOps.create({
      customer_id, customer_nama, customer_tipe, kategori,
      jumlah, jenis, status, deskripsi
    }, req.user.id);
    
    broadcast({ type: 'transaction_updated', data: transaction });
    
    res.json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/transactions/:id/mark-lunas', authenticateToken, (req, res) => {
  try {
    const result = transactionOps.markAsLunas(req.params.id, req.user.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    }
    
    broadcast({ type: 'transaction_updated' });
    
    res.json({ success: true, message: 'Transaksi ditandai lunas' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
  try {
    const result = transactionOps.delete(req.params.id, req.user.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Transaksi tidak ditemukan' });
    }
    
    broadcast({ type: 'transaction_updated' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SETTINGS API ====================

app.get('/api/settings', authenticateToken, (req, res) => {
  try {
    const settings = settingsOps.getAll();
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings', authenticateToken, (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, error: 'Key dan value diperlukan' });
    }
    
    settingsOps.set(key, value);
    broadcast({ type: 'settings_updated', key, value });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== WHATSAPP API ====================

app.get('/api/whatsapp/status', authenticateToken, (req, res) => {
  try {
    const status = whatsapp.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/start', authenticateToken, (req, res) => {
  try {
    const result = whatsapp.startService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/stop', authenticateToken, (req, res) => {
  try {
    const result = whatsapp.stopService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/send-billing', authenticateToken, (req, res) => {
  try {
    const { customerId, template, amount } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ success: false, error: 'Customer ID diperlukan' });
    }
    
    const customer = customerOps.getById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan' });
    }
    
    // Format message
    let message = template;
    const period = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    message = message
      .replace(/\{nama\}/g, customer.nama)
      .replace(/\{jumlah\}/g, amount ? parseInt(amount).toLocaleString('id-ID') : '0')
      .replace(/\{tipe\}/g, customer.tipe === 'internet' ? 'Internet/PPPoE' : 'LPG 3kg')
      .replace(/\{tanggal\}/g, today)
      .replace(/\{periode\}/g, period)
      .replace(/\{username\}/g, customer.username_pppoe || '-')
      .replace(/\{password\}/g, customer.password_pppoe || '-');
    
    const result = whatsapp.sendBillingMessage(customerId, message, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/broadcast', authenticateToken, (req, res) => {
  try {
    const { template } = req.body;
    
    if (!template) {
      return res.status(400).json({ success: false, error: 'Template diperlukan' });
    }
    
    const result = whatsapp.broadcastBillingMessage(template, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/whatsapp/logs', authenticateToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = whatsapp.getMessageLogs(limit);
    const stats = whatsapp.getMessageStats();
    res.json({ success: true, data: logs, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== BACKUP/RESTORE API ====================

app.get('/api/backup', authenticateToken, requireAdmin, (req, res) => {
  try {
    const customers = customerOps.getAll();
    const transactions = transactionOps.getAll();
    const settings = settingsOps.getAll();
    const users = userOps.getAll().map(u => ({ ...u, password: '***HIDDEN***' }));
    
    const backup = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: req.user.username,
      customers,
      transactions,
      settings,
      users
    };
    
    res.json(backup);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/restore', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { customers, transactions, settings } = req.body;
    
    if (customers && Array.isArray(customers)) {
      customers.forEach(c => {
        customerOps.create({ ...c }, req.user.id);
      });
    }
    
    if (settings) {
      Object.entries(settings).forEach(([key, value]) => {
        settingsOps.set(key, value);
      });
    }
    
    broadcast({ type: 'data_restored' });
    userOps.logActivity(req.user.id, 'RESTORE_DATA', 'Restore data dari backup');
    
    res.json({ success: true, message: 'Data berhasil dipulihkan' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ACTIVITY LOGS ====================

app.get('/api/activity-logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT a.*, u.username
      FROM activity_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all();
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: Get database reference
const { db } = require('./database');

// ==================== SERVE FRONTEND ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║   🚀 PPPoE Billing Server Started                                  ║
║                                                                    ║
║   📡 Server:    http://localhost:${PORT}                             ║
║   🔌 API:       http://localhost:${PORT}/api                        ║
║                                                                    ║
║   👤 Default Users:                                               ║
║   ├─ Admin:   admin / admin123                                     ║
║   └─ Staff:   staff / staff123                                     ║
║                                                                    ║
║   ✨ Multi-User with Real-time Sync                                ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await whatsapp.stopService();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await whatsapp.stopService();
  process.exit(0);
});
