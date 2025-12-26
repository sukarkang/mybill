const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'billing.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize all tables
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nama_lengkap TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
    aktif INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Customers table
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    tipe TEXT NOT NULL CHECK(tipe IN ('internet', 'gas')),
    whatsapp TEXT NOT NULL,
    username_pppoe TEXT,
    password_pppoe TEXT,
    alamat TEXT,
    aktif INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- Transactions table
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    customer_nama TEXT NOT NULL,
    customer_tipe TEXT NOT NULL,
    kategori TEXT NOT NULL,
    jumlah INTEGER NOT NULL,
    jenis TEXT NOT NULL CHECK(jenis IN ('pemasukan', 'pengeluaran')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'lunas')),
    deskripsi TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- Settings table
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY UNIQUE,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Message logs table
  CREATE TABLE IF NOT EXISTS message_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    customer_nama TEXT,
    phone TEXT NOT NULL,
    message_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'pending')),
    message_preview TEXT,
    error_message TEXT,
    sent_by INTEGER,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (sent_by) REFERENCES users(id)
  );

  -- Activity logs untuk audit trail
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Create default admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO users (username, password, nama_lengkap, role)
    VALUES (?, ?, ?, ?)
  `).run('admin', hashedPassword, 'Administrator', 'admin');
  console.log('✅ Default admin user created (admin / admin123)');
}

// Create default staff user
const staffExists = db.prepare('SELECT id FROM users WHERE username = ?').get('staff');
if (!staffExists) {
  const hashedPassword = bcrypt.hashSync('staff123', 10);
  db.prepare(`
    INSERT INTO users (username, password, nama_lengkap, role)
    VALUES (?, ?, ?, ?)
  `).run('staff', hashedPassword, 'Staff Kasir', 'staff');
  console.log('✅ Default staff user created (staff / staff123)');
}

// Insert default settings
const defaultSettings = {
  'price_internet': '150000',
  'price_gas': '22000',
  'app_name': 'PPPoE Billing Pro',
  'business_address': '-'
};

Object.entries(defaultSettings).forEach(([key, value]) => {
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `).run(key, value);
});

console.log('✅ Database initialized at:', dbPath);

// ==================== USER OPERATIONS ====================
const userOps = {
  getAll: () => db.prepare('SELECT id, username, nama_lengkap, role, aktif, created_at FROM users ORDER BY role, nama_lengkap').all(),
  
  getById: (id) => db.prepare('SELECT id, username, nama_lengkap, role, aktif, created_at FROM users WHERE id = ?').get(id),
  
  getByUsername: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
  
  create: (data) => {
    const hashedPassword = bcrypt.hashSync(data.password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (username, password, nama_lengkap, role)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(data.username, hashedPassword, data.nama_lengkap, data.role || 'staff');
    return { id: result.lastInsertRowid, ...data };
  },
  
  update: (id, data) => {
    let query = 'UPDATE users SET nama_lengkap = ?, role = ?, aktif = ?, updated_at = CURRENT_TIMESTAMP';
    const params = [data.nama_lengkap, data.role, data.aktif ? 1 : 0];
    
    if (data.password) {
      query += ', password = ?';
      params.push(bcrypt.hashSync(data.password, 10));
    }
    
    query += ' WHERE id = ?';
    params.push(id);
    
    db.prepare(query).run(...params);
    return userOps.getById(id);
  },
  
  verifyPassword: (user, password) => {
    return bcrypt.compareSync(password, user.password);
  },
  
  logActivity: (userId, action, details = '', ip = '') => {
    db.prepare('INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(userId, action, details, ip);
  }
};

// ==================== CUSTOMER OPERATIONS ====================
const customerOps = {
  getAll: (filter = {}) => {
    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    
    if (filter.tipe) {
      query += ' AND tipe = ?';
      params.push(filter.tipe);
    }
    
    if (filter.aktif !== undefined) {
      query += ' AND aktif = ?';
      params.push(filter.aktif ? 1 : 0);
    }
    
    if (filter.search) {
      query += ' AND (nama LIKE ? OR whatsapp LIKE ?)';
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    
    query += ' ORDER BY nama';
    
    return db.prepare(query).all(...params);
  },
  
  getById: (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id),
  
  getWithPending: () => {
    return db.prepare(`
      SELECT c.*, SUM(t.jumlah) as total_debt
      FROM customers c
      INNER JOIN transactions t ON c.id = t.customer_id
      WHERE t.status = 'pending' AND c.aktif = 1
      GROUP BY c.id
      HAVING total_debt > 0
      ORDER BY c.nama
    `).all();
  },
  
  create: (data, userId = null) => {
    const stmt = db.prepare(`
      INSERT INTO customers (nama, tipe, whatsapp, username_pppoe, password_pppoe, alamat, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.nama, data.tipe, data.whatsapp, 
      data.username_pppoe || null, data.password_pppoe || null, 
      data.alamat || null, userId
    );
    
    if (userId) userOps.logActivity(userId, 'CREATE_CUSTOMER', `Menambah customer: ${data.nama}`);
    
    return { id: result.lastInsertRowid, ...data };
  },
  
  update: (id, data, userId = null) => {
    const stmt = db.prepare(`
      UPDATE customers SET nama = ?, tipe = ?, whatsapp = ?, username_pppoe = ?, password_pppoe = ?, alamat = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(data.nama, data.tipe, data.whatsapp, data.username_pppoe || null, data.password_pppoe || null, data.alamat || null, id);
    
    if (userId) userOps.logActivity(userId, 'UPDATE_CUSTOMER', `Update customer: ${data.nama}`);
    
    return customerOps.getById(id);
  },
  
  delete: (id, userId = null) => {
    const customer = customerOps.getById(id);
    if (customer) {
      db.prepare('DELETE FROM customers WHERE id = ?').run(id);
      if (userId) userOps.logActivity(userId, 'DELETE_CUSTOMER', `Hapus customer: ${customer.nama}`);
      return true;
    }
    return false;
  }
};

// ==================== TRANSACTION OPERATIONS ====================
const transactionOps = {
  getAll: (filter = {}) => {
    let query = 'SELECT t.*, c.tipe as customer_tipe FROM transactions t LEFT JOIN customers c ON t.customer_id = c.id WHERE 1=1';
    const params = [];
    
    if (filter.status) {
      query += ' AND t.status = ?';
      params.push(filter.status);
    }
    
    if (filter.jenis) {
      query += ' AND t.jenis = ?';
      params.push(filter.jenis);
    }
    
    if (filter.customer_id) {
      query += ' AND t.customer_id = ?';
      params.push(filter.customer_id);
    }
    
    query += ' ORDER BY t.created_at DESC';
    
    if (filter.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }
    
    return db.prepare(query).all(...params);
  },
  
  getById: (id) => {
    return db.prepare('SELECT t.*, c.tipe as customer_tipe FROM transactions t LEFT JOIN customers c ON t.customer_id = c.id WHERE t.id = ?').get(id);
  },
  
  getPendingByCustomer: (customerId) => {
    return db.prepare('SELECT * FROM transactions WHERE customer_id = ? AND status = "pending" ORDER BY created_at DESC').all(customerId);
  },
  
  getStats: () => {
    const income = db.prepare('SELECT COALESCE(SUM(jumlah), 0) as total FROM transactions WHERE jenis = "pemasukan"').get().total;
    const expense = db.prepare('SELECT COALESCE(SUM(jumlah), 0) as total FROM transactions WHERE jenis = "pengeluaran"').get().total;
    const pending = db.prepare('SELECT COALESCE(SUM(jumlah), 0) as total FROM transactions WHERE status = "pending"').get().total;
    
    return { income, expense, pending, balance: income - expense };
  },
  
  getMonthlyData: () => {
    return db.prepare(`
      SELECT 
        strftime('%m', created_at) as month,
        SUM(CASE WHEN jenis = 'pemasukan' THEN jumlah ELSE 0 END) as income,
        SUM(CASE WHEN jenis = 'pengeluaran' THEN jumlah ELSE 0 END) as expense
      FROM transactions
      WHERE strftime('%Y', created_at) = strftime('%Y', 'now')
      GROUP BY month
      ORDER BY month
    `).all();
  },
  
  create: (data, userId = null) => {
    const stmt = db.prepare(`
      INSERT INTO transactions (customer_id, customer_nama, customer_tipe, kategori, jumlah, jenis, status, deskripsi, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.customer_id, data.customer_nama, data.customer_tipe,
      data.kategori, data.jumlah, data.jenis,
      data.status || 'pending', data.deskripsi || null, userId
    );
    
    if (userId) userOps.logActivity(userId, 'CREATE_TRANSACTION', `${data.jenis}: ${formatIDR(data.jumlah)} untuk ${data.customer_nama}`);
    
    return { id: result.lastInsertRowid, ...data };
  },
  
  markAsLunas: (id, userId = null) => {
    const t = transactionOps.getById(id);
    if (t) {
      // Update original transaction
      db.prepare('UPDATE transactions SET status = "lunas", updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      
      // Create income record
      db.prepare(`
        INSERT INTO transactions (customer_id, customer_nama, customer_tipe, kategori, jumlah, jenis, status, deskripsi, created_by)
        VALUES (?, ?, ?, ?, ?, 'pemasukan', 'lunas', 'Pembayaran otomatis', ?)
      `).run(t.customer_id, t.customer_nama, t.customer_tipe, t.kategori, t.jumlah, userId);
      
      if (userId) userOps.logActivity(userId, 'PAYMENT', `Pembayaran: ${formatIDR(t.jumlah)} dari ${t.customer_nama}`);
      
      return true;
    }
    return false;
  },
  
  delete: (id, userId = null) => {
    const t = transactionOps.getById(id);
    if (t) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
      if (userId) userOps.logActivity(userId, 'DELETE_TRANSACTION', `Hapus transaksi: ${formatIDR(t.jumlah)}`);
      return true;
    }
    return false;
  }
};

// ==================== SETTINGS OPERATIONS ====================
const settingsOps = {
  get: (key) => {
    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return result ? result.value : null;
  },
  
  getAll: () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    return settings;
  },
  
  set: (key, value) => {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `).run(key, value, value);
    return true;
  }
};

// ==================== MESSAGE LOG OPERATIONS ====================
const messageOps = {
  create: (data) => {
    const stmt = db.prepare(`
      INSERT INTO message_logs (customer_id, customer_nama, phone, message_type, status, message_preview, error_message, sent_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      data.customer_id || null, data.customer_nama || null, data.phone,
      data.message_type, data.status, data.message_preview || null,
      data.error_message || null, data.sent_by || null
    );
  },
  
  getRecent: (limit = 50) => {
    return db.prepare(`
      SELECT m.*, u.username as sent_by_username
      FROM message_logs m
      LEFT JOIN users u ON m.sent_by = u.id
      ORDER BY m.sent_at DESC
      LIMIT ?
    `).all(limit);
  },
  
  getStats: () => {
    const total = db.prepare('SELECT COUNT(*) as count FROM message_logs').get().count;
    const success = db.prepare('SELECT COUNT(*) as count FROM message_logs WHERE status = "success"').get().count;
    const failed = db.prepare('SELECT COUNT(*) as count FROM message_logs WHERE status = "failed"').get().count;
    return { total, success, failed };
  }
};

// Helper function
function formatIDR(num) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
}

module.exports = {
  db,
  userOps,
  customerOps,
  transactionOps,
  settingsOps,
  messageOps
};
