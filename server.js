const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Betnex } = require('@betnex/sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

console.log('🚀 Server starting...');

// ==================== SQLITE DATABASE ====================
const db = new sqlite3.Database('./betvora.db', (err) => {
    if (err) {
        console.error('❌ Database error:', err.message);
    } else {
        console.log('✅ SQLite database connected');
    }
});

global.db = db;

// ==================== CREATE TABLES ====================
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            balance REAL DEFAULT 0,
            bonus_balance REAL DEFAULT 0,
            total_wagered REAL DEFAULT 0,
            total_won REAL DEFAULT 0,
            degen_rank TEXT DEFAULT 'bronze',
            win_streak INTEGER DEFAULT 0,
            biggest_win REAL DEFAULT 0,
            referral_code TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_after REAL NOT NULL,
            reference TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            game_type TEXT NOT NULL,
            bet_amount REAL NOT NULL,
            win_amount REAL DEFAULT 0,
            multiplier REAL DEFAULT 0,
            game_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('✅ Tables created/verified');
});

// ==================== HELPER FUNCTIONS ====================
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function queryOne(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = decoded;
        next();
    });
}

// ==================== BETNEX GAME PROVIDER ====================
const betnex = new Betnex(process.env.BETNEX_API_KEY || 'test-key', { debug: false });

// Get games list - FIXED
app.get('/api/provider/games', authenticateToken, async (req, res) => {
    try {
        console.log('📡 Fetching Betnex games...');
        const providers = await betnex.getProviders();
        console.log('✅ Providers:', providers);
        
        // Check if providers array is valid
        if (!providers || providers.length === 0) {
            return res.status(400).json({ error: 'No providers available. Check your API key.' });
        }
        
        // Try each provider until we find games
        let games = [];
        let usedProvider = null;
        for (const provider of providers) {
            try {
                console.log(`🔍 Trying provider: ${provider}`);
                games = await betnex.getGames(provider);
                if (games && games.length > 0) {
                    usedProvider = provider;
                    console.log(`✅ Found ${games.length} games from ${provider}`);
                    break;
                }
            } catch (e) {
                console.log(`❌ No games from ${provider}:`, e.message);
            }
        }
        
        if (games.length === 0) {
            console.log('⚠️ No games found from any provider');
        }
        
        res.json({ success: true, providers, games, usedProvider });
    } catch (error) {
        console.error('❌ Betnex games error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Launch a game
app.post('/api/provider/launch', authenticateToken, async (req, res) => {
    try {
        const { gameId, bet } = req.body;
        const userId = req.user.id;

        const user = await queryOne('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (bet > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        await run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

        const launch = await betnex.launchGame({
            username: userId.toString(),
            gameId: gameId,
            money: Math.round(bet * 100),
            platform: 1,
            currency: "USD",
            home_url: "https://betvora.com",
            lang: "en",
        });

        res.json({ success: true, gameUrl: launch.payload.game_launch_url });
    } catch (error) {
        console.error('Launch game error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Webhook for game results
app.post('/api/webhook/betnex', async (req, res) => {
    try {
        const { username, serial_number, amount } = req.body;

        const existing = await queryOne('SELECT * FROM transactions WHERE reference = ?', [serial_number]);
        if (existing) {
            return res.json({ success: true });
        }

        const amountInDollars = amount / 100;
        await run('UPDATE users SET balance = balance + ? WHERE id = ?', [amountInDollars, parseInt(username)]);

        await run(
            'INSERT INTO transactions (user_id, type, amount, reference, status) VALUES (?, ?, ?, ?, ?)',
            [parseInt(username), 'game', amountInDollars, serial_number, 'completed']
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.status(500).json({ success: false });
    }
});

// ==================== AUTH ROUTES ====================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await queryOne(
            'SELECT * FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const referralCode = username.slice(0, 4) + Math.random().toString(36).slice(2, 6);

        const result = await run(
            `INSERT INTO users (username, email, password_hash, referral_code)
             VALUES (?, ?, ?, ?)`,
            [username, email, hashedPassword, referralCode]
        );

        const user = await queryOne(
            'SELECT id, username, email, balance FROM users WHERE id = ?',
            [result.lastID]
        );

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            user,
            token
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await queryOne(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
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
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== PLINKO GAME ====================
app.post('/api/games/plinko', authenticateToken, async (req, res) => {
    try {
        const { bet } = req.body;
        const userId = req.user.id;

        if (!bet || bet < 0.10) {
            return res.status(400).json({ error: 'Minimum bet is $0.10' });
        }

        const user = await queryOne(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (bet > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        await run(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [bet, userId]
        );

        const multipliers = [0.5, 1.2, 5.0, 1.2, 0.5];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
        const winAmount = bet * mult;
        const isWin = mult >= 1;

        if (isWin) {
            await run(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [winAmount, userId]
            );
        }

        const updated = await queryOne(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

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
        res.status(500).json({ error: 'Game failed: ' + error.message });
    }
});

// ==================== WALLET ====================
app.get('/api/wallet/balance', authenticateToken, async (req, res) => {
    try {
        const user = await queryOne(
            'SELECT balance, bonus_balance FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            balance: user.balance,
            bonusBalance: user.bonus_balance || 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'BetVora API is running! 🚀' });
});

app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working! 🎉', database: 'SQLite' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`🗄️  Database: SQLite (betvora.db)`);
    console.log(`📡 API: http://localhost:${PORT}/api/test`);
    console.log(`📝 Register: POST /api/auth/register`);
});
