const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Betnex } = require('@betnex/sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== DATABASE ==========
const db = new sqlite3.Database('betvora.db');

// Create users table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create transactions table
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount REAL,
    game TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// ========== BETNEX SETUP ==========
// Check if Betnex API keys exist
const BETNEX_API_KEY = process.env.BETNEX_API_KEY;
const BETNEX_SECRET = process.env.BETNEX_SECRET;

let betnex = null;
if (BETNEX_API_KEY && BETNEX_SECRET) {
  betnex = new Betnex({
    apiKey: BETNEX_API_KEY,
    secret: BETNEX_SECRET,
  });
  console.log('✅ Betnex initialized');
} else {
  console.log('⚠️ Betnex API keys not found. Games will use demo mode.');
}

// ========== API ENDPOINTS ==========

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'BetVora API is running! 🚀',
    betnex: betnex ? 'Connected' : 'Not configured',
    version: '1.0.0'
  });
});

// Register user
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  db.run(
    'INSERT INTO users (username, email, password, balance) VALUES (?, ?, ?, 100)',
    [username, email, password],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Username or email already exists' });
      }
      res.json({ 
        success: true, 
        userId: this.lastID,
        username: username,
        balance: 100
      });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get(
    'SELECT * FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      res.json({
        success: true,
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance
      });
    }
  );
});

// Get user balance
app.get('/api/user/:id/balance', (req, res) => {
  db.get(
    'SELECT balance FROM users WHERE id = ?',
    [req.params.id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ balance: row.balance });
    }
  );
});

// ========== BETNEX GAME ENDPOINTS ==========

// Get available games
app.get('/api/provider/games', async (req, res) => {
  try {
    if (!betnex) {
      // Demo games if no Betnex
      return res.json({
        games: [
          { id: 'plinko', name: 'Plinko', provider: 'BetVora Demo', icon: '🟢' },
          { id: 'mines', name: 'Mines', provider: 'BetVora Demo', icon: '💣' },
          { id: 'crash', name: 'Crash', provider: 'BetVora Demo', icon: '🚀' },
          { id: 'dice', name: 'Dice', provider: 'BetVora Demo', icon: '🎲' },
          { id: 'slots', name: 'Slots', provider: 'BetVora Demo', icon: '🎰' },
        ]
      });
    }
    
    // Real games from Betnex
    const games = await betnex.getGames({
      providers: ['SPRIBE', 'PRAGMATIC', 'EVOLUTION'],
      limit: 50,
    });
    
    res.json({ games: games });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Launch a game
app.post('/api/provider/launch', async (req, res) => {
  try {
    const { gameId, bet, userId } = req.body;
    
    // Get user balance
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (bet > user.balance) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct bet immediately
    db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);
    
    // Record transaction
    db.run(
      'INSERT INTO transactions (user_id, type, amount, game) VALUES (?, ?, ?, ?)',
      [userId, 'bet', -bet, 'game_' + gameId]
    );
    
    if (!betnex) {
      // Demo mode
      return res.json({
        gameUrl: null,
        isDemo: true,
        gameId: gameId,
      });
    }
    
    // Launch real game with Betnex
    const launch = await betnex.launchGame({
      username: user.username,
      gameId: gameId,
      money: user.balance - bet,
      platform: 1,
      currency: 'USD',
      home_url: 'https://yourdomain.com',
      lang: 'en',
    });
    
    res.json({
      gameUrl: launch.payload.game_launch_url,
      isDemo: false,
    });
  } catch (error) {
    console.error('Error launching game:', error);
    res.status(500).json({ error: 'Failed to launch game' });
  }
});

// ========== BETNEX WEBHOOK ==========
app.post('/api/betnex/callback', (req, res) => {
  const callback = req.body;
  console.log('Betnex callback:', callback);
  
  // Process win/loss
  const { serialNumber, memberAccount, betAmount, winAmount, status } = callback;
  
  if (status === 'completed') {
    // Update user balance with winnings
    db.get('SELECT id FROM users WHERE username = ?', [memberAccount], (err, user) => {
      if (user) {
        const netChange = winAmount - betAmount;
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [netChange, user.id]);
        
        if (winAmount > 0) {
          db.run(
            'INSERT INTO transactions (user_id, type, amount, game) VALUES (?, ?, ?, ?)',
            [user.id, 'win', winAmount, 'game']
          );
        }
      }
    });
  }
  
  res.json({ status: 'ok' });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: SQLite (betvora.db)`);
  console.log(`🔗 API: http://localhost:${PORT}/api/test`);
  console.log(`🎮 Betnex: ${betnex ? '✅ Connected' : '❌ Demo mode'}`);
});const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Betnex } = require('@betnex/sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== DATABASE ==========
const db = new sqlite3.Database('betvora.db');

// Create users table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create transactions table
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount REAL,
    game TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// ========== BETNEX SETUP ==========
// Check if Betnex API keys exist
const BETNEX_API_KEY = process.env.BETNEX_API_KEY;
const BETNEX_SECRET = process.env.BETNEX_SECRET;

let betnex = null;
if (BETNEX_API_KEY && BETNEX_SECRET) {
  betnex = new Betnex({
    apiKey: BETNEX_API_KEY,
    secret: BETNEX_SECRET,
  });
  console.log('✅ Betnex initialized');
} else {
  console.log('⚠️ Betnex API keys not found. Games will use demo mode.');
}

// ========== API ENDPOINTS ==========

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'BetVora API is running! 🚀',
    betnex: betnex ? 'Connected' : 'Not configured',
    version: '1.0.0'
  });
});

// Register user
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  db.run(
    'INSERT INTO users (username, email, password, balance) VALUES (?, ?, ?, 100)',
    [username, email, password],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Username or email already exists' });
      }
      res.json({ 
        success: true, 
        userId: this.lastID,
        username: username,
        balance: 100
      });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get(
    'SELECT * FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      res.json({
        success: true,
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance
      });
    }
  );
});

// Get user balance
app.get('/api/user/:id/balance', (req, res) => {
  db.get(
    'SELECT balance FROM users WHERE id = ?',
    [req.params.id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ balance: row.balance });
    }
  );
});

// ========== BETNEX GAME ENDPOINTS ==========

// Get available games
app.get('/api/provider/games', async (req, res) => {
  try {
    if (!betnex) {
      // Demo games if no Betnex
      return res.json({
        games: [
          { id: 'plinko', name: 'Plinko', provider: 'BetVora Demo', icon: '🟢' },
          { id: 'mines', name: 'Mines', provider: 'BetVora Demo', icon: '💣' },
          { id: 'crash', name: 'Crash', provider: 'BetVora Demo', icon: '🚀' },
          { id: 'dice', name: 'Dice', provider: 'BetVora Demo', icon: '🎲' },
          { id: 'slots', name: 'Slots', provider: 'BetVora Demo', icon: '🎰' },
        ]
      });
    }
    
    // Real games from Betnex
    const games = await betnex.getGames({
      providers: ['SPRIBE', 'PRAGMATIC', 'EVOLUTION'],
      limit: 50,
    });
    
    res.json({ games: games });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Launch a game
app.post('/api/provider/launch', async (req, res) => {
  try {
    const { gameId, bet, userId } = req.body;
    
    // Get user balance
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (bet > user.balance) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct bet immediately
    db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);
    
    // Record transaction
    db.run(
      'INSERT INTO transactions (user_id, type, amount, game) VALUES (?, ?, ?, ?)',
      [userId, 'bet', -bet, 'game_' + gameId]
    );
    
    if (!betnex) {
      // Demo mode
      return res.json({
        gameUrl: null,
        isDemo: true,
        gameId: gameId,
      });
    }
    
    // Launch real game with Betnex
    const launch = await betnex.launchGame({
      username: user.username,
      gameId: gameId,
      money: user.balance - bet,
      platform: 1,
      currency: 'USD',
      home_url: 'https://yourdomain.com',
      lang: 'en',
    });
    
    res.json({
      gameUrl: launch.payload.game_launch_url,
      isDemo: false,
    });
  } catch (error) {
    console.error('Error launching game:', error);
    res.status(500).json({ error: 'Failed to launch game' });
  }
});

// ========== BETNEX WEBHOOK ==========
app.post('/api/betnex/callback', (req, res) => {
  const callback = req.body;
  console.log('Betnex callback:', callback);
  
  // Process win/loss
  const { serialNumber, memberAccount, betAmount, winAmount, status } = callback;
  
  if (status === 'completed') {
    // Update user balance with winnings
    db.get('SELECT id FROM users WHERE username = ?', [memberAccount], (err, user) => {
      if (user) {
        const netChange = winAmount - betAmount;
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [netChange, user.id]);
        
        if (winAmount > 0) {
          db.run(
            'INSERT INTO transactions (user_id, type, amount, game) VALUES (?, ?, ?, ?)',
            [user.id, 'win', winAmount, 'game']
          );
        }
      }
    });
  }
  
  res.json({ status: 'ok' });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: SQLite (betvora.db)`);
  console.log(`🔗 API: http://localhost:${PORT}/api/test`);
  console.log(`🎮 Betnex: ${betnex ? '✅ Connected' : '❌ Demo mode'}`);
});
