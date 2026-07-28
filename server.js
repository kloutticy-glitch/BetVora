const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());

console.log('🚀 Server starting...');

// ==================== DATABASE ====================
const db = new Database('./betvora.db', { verbose: console.log });

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        balance REAL DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS game_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        game_type TEXT NOT NULL,
        bet_amount REAL NOT NULL,
        win_amount REAL DEFAULT 0,
        multiplier REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

console.log('✅ Database connected and tables created');

// ==================== AUTH ====================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, username);

        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = db.prepare(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
        ).run(username, email, hashedPassword);

        const user = db.prepare('SELECT id, username, email, balance FROM users WHERE id = ?').get(result.lastInsertRowid);

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            user,
            token
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                balance: user.balance
            },
            token
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== GAMES ====================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret123', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = decoded;
        next();
    });
}

app.post('/api/games/plinko', authenticateToken, async (req, res) => {
    try {
        const { bet } = req.body;
        const userId = req.user.id;

        if (!bet || bet < 0.10) {
            return res.status(400).json({ error: 'Minimum bet is $0.10' });
        }

        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (bet > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(bet, userId);

        const multipliers = [0.5, 1.2, 5.0, 1.2, 0.5];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
        const winAmount = bet * mult;
        const isWin = mult >= 1;

        if (isWin) {
            db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(winAmount, userId);
        }

        const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

        res.json({
            success: true,
            result: {
                multiplier: mult,
                winAmount: isWin ? winAmount : 0,
                isWin
            },
            newBalance: updated.balance
        });
    } catch (error) {
        console.error('Plinko error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

app.get('/api/wallet/balance', authenticateToken, (req, res) => {
    try {
        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
        res.json({ balance: user.balance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working! 🎉',
        status: 'Connected to SQLite on Render!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'BetVora API is running! 🚀',
        timestamp: new Date().toISOString()
    });
});

// ==================== START ====================
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api/test`);
});
