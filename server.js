const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());

console.log('🚀 Server starting...');

// ==================== IN-MEMORY DATABASE ====================
// This stores everything in memory (data resets when server restarts)
const db = {
    users: [],
    games: [],
    nextUserId: 1
};

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

        // Check if user exists
        const existing = db.users.find(u => u.email === email || u.username === username);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            id: db.nextUserId++,
            username,
            email,
            password_hash: hashedPassword,
            balance: 100.00,
            created_at: new Date().toISOString()
        };
        db.users.push(user);

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );

        res.status(201).json({
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
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = db.users.find(u => u.email === email);
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

// ==================== AUTH MIDDLEWARE ====================
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

// ==================== GAMES ====================

// Plinko
app.post('/api/games/plinko', authenticateToken, async (req, res) => {
    try {
        const { bet } = req.body;
        const userId = req.user.id;

        if (!bet || bet < 0.10) {
            return res.status(400).json({ error: 'Minimum bet is $0.10' });
        }

        const user = db.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (bet > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        user.balance -= bet;

        const multipliers = [0.5, 1.2, 5.0, 1.2, 0.5];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
        const winAmount = bet * mult;
        const isWin = mult >= 1;

        if (isWin) {
            user.balance += winAmount;
        }

        // Save game
        db.games.push({
            user_id: userId,
            game_type: 'plinko',
            bet_amount: bet,
            win_amount: isWin ? winAmount : 0,
            multiplier: mult,
            created_at: new Date().toISOString()
        });

        res.json({
            success: true,
            result: {
                multiplier: mult,
                winAmount: isWin ? winAmount : 0,
                isWin
            },
            newBalance: user.balance
        });
    } catch (error) {
        console.error('Plinko error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// Get Balance
app.get('/api/wallet/balance', authenticateToken, (req, res) => {
    try {
        const user = db.users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ balance: user.balance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

// Test
app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working! 🎉',
        status: 'Ready to use!',
        users: db.users.length,
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
    console.log(`💾 Memory database ready (data resets on restart)`);
});
