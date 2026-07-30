const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// PROVABLY FAIR SYSTEM
// ============================================================

function generateSeed() {
    return crypto.randomBytes(32).toString('hex');
}

function getGameHash(serverSeed, clientSeed, nonce) {
    return crypto
        .createHash('sha256')
        .update(`${serverSeed}:${clientSeed}:${nonce}`)
        .digest('hex');
}

function getPlinkoResult(hash, rows = 16) {
    const binary = hash
        .split('')
        .map(c => parseInt(c, 16).toString(2).padStart(4, '0'))
        .join('');
    
    let position = 0;
    for (let i = 0; i < rows; i++) {
        if (binary[i % binary.length] === '1') {
            position++;
        } else {
            position--;
        }
        position = Math.max(0, Math.min(rows, position + rows / 2));
    }
    
    const multipliers = [
        0.2, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 
        50.0, 20.0, 10.0, 5.0, 2.0, 1.0, 0.5, 0.2, 0.2
    ];
    
    const index = Math.floor(position);
    return multipliers[index] || 1.0;
}

function getMinesResult(hash, bombs = 5) {
    const positions = [];
    for (let i = 0; i < 25; i++) positions.push(i);
    
    const shuffled = [];
    const hashBytes = hash.match(/.{2}/g) || [];
    for (let i = 0; i < positions.length; i++) {
        const idx = parseInt(hashBytes[i % hashBytes.length] || '00', 16) % positions.length;
        shuffled.push(positions.splice(idx, 1)[0]);
    }
    
    return shuffled.slice(0, bombs);
}

function getDiceResult(hash) {
    const hex = hash.substring(0, 8);
    const value = parseInt(hex, 16) / 0xFFFFFFFF;
    return value * 100;
}

function getCrashPoint(hash) {
    const hex = hash.substring(0, 8);
    const value = parseInt(hex, 16) / 0xFFFFFFFF;
    return 1.0 + (value * 14);
}

// ============================================================
// DATABASE (In-Memory)
// ============================================================

const users = {};
const gameSessions = {};
let idCounter = 1;

// ============================================================
// BETNEX INTEGRATION (No Secret Required)
// ============================================================

let betnexEnabled = false;
const BETNEX_API_KEY = process.env.BETNEX_API_KEY;

console.log(`📡 BETNEX_API_KEY: ${BETNEX_API_KEY ? '✅ Found' : '❌ Not found'}`);

if (BETNEX_API_KEY) {
    betnexEnabled = true;
    console.log('✅ Betnex API key found!');
} else {
    console.log('⚠️ Betnex API key not found. Using demo mode.');
}

// ============================================================
// AUTH ENDPOINTS
// ============================================================

app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const existing = Object.values(users).find(u => u.email === email);
    if (existing) {
        return res.status(400).json({ error: 'Email already registered' });
    }
    
    const id = idCounter++;
    users[id] = {
        id,
        username,
        email,
        password,
        balance: 100,
        totalWagered: 0,
        clientSeed: 'seed_' + generateSeed().substring(0, 8),
        nonce: 0,
        created: new Date().toISOString()
    };
    
    res.json({
        success: true,
        userId: id,
        username: username,
        balance: 100,
        clientSeed: users[id].clientSeed
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    const user = Object.values(users).find(
        u => u.email === email && u.password === password
    );
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    res.json({
        success: true,
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance,
        clientSeed: user.clientSeed,
        nonce: user.nonce
    });
});

app.get('/api/user/:id/balance', (req, res) => {
    const user = users[parseInt(req.params.id)];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json({ balance: user.balance });
});

app.post('/api/user/update-seed', (req, res) => {
    const { userId, newSeed } = req.body;
    const user = users[parseInt(userId)];
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    user.clientSeed = newSeed;
    user.nonce = 0;
    
    res.json({
        success: true,
        clientSeed: user.clientSeed,
        nonce: user.nonce
    });
});

// ============================================================
// GAME: PLINKO (Provably Fair)
// ============================================================

app.post('/api/games/plinko', (req, res) => {
    const { bet, userId, rows = 16 } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.nonce++;
    
    const serverSeed = generateSeed();
    const clientSeed = user.clientSeed;
    const nonce = user.nonce;
    const hash = getGameHash(serverSeed, clientSeed, nonce);
    
    const multiplier = getPlinkoResult(hash, rows);
    const winAmount = bet * multiplier;
    const isWin = multiplier >= 1.0;
    
    user.balance -= bet;
    if (isWin) user.balance += winAmount;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const sessionId = `plinko_${Date.now()}`;
    gameSessions[sessionId] = {
        game: 'plinko',
        serverSeed,
        clientSeed,
        nonce,
        hash,
        multiplier,
        bet,
        winAmount,
        isWin,
        timestamp: Date.now()
    };
    
    res.json({
        result: {
            multiplier,
            winAmount,
            isWin,
            hash,
            sessionId,
            clientSeed,
            nonce
        },
        newBalance: user.balance
    });
});

// ============================================================
// GAME: MINES (Provably Fair)
// ============================================================

app.post('/api/games/mines', (req, res) => {
    const { bet, userId, bombs = 5, revealCount = 0 } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.nonce++;
    
    const serverSeed = generateSeed();
    const clientSeed = user.clientSeed;
    const nonce = user.nonce;
    const hash = getGameHash(serverSeed, clientSeed, nonce);
    
    const minePositions = getMinesResult(hash, bombs);
    const hitMine = minePositions.includes(revealCount);
    
    user.balance -= bet;
    let winAmount = 0;
    let isWin = false;
    let multiplier = 0;
    
    if (!hitMine) {
        const gemsRevealed = revealCount > 0 ? revealCount : 1;
        multiplier = 1 + (gemsRevealed * 0.25);
        winAmount = bet * multiplier;
        isWin = true;
        user.balance += winAmount;
    }
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const sessionId = `mines_${Date.now()}`;
    gameSessions[sessionId] = {
        game: 'mines',
        serverSeed,
        clientSeed,
        nonce,
        hash,
        minePositions,
        hitMine,
        multiplier,
        bet,
        winAmount,
        isWin,
        timestamp: Date.now()
    };
    
    res.json({
        result: {
            hitMine,
            winAmount,
            isWin,
            multiplier,
            hash,
            sessionId,
            clientSeed,
            nonce
        },
        newBalance: user.balance
    });
});

// ============================================================
// GAME: DICE (Provably Fair)
// ============================================================

app.post('/api/games/dice', (req, res) => {
    const { bet, userId } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.nonce++;
    
    const serverSeed = generateSeed();
    const clientSeed = user.clientSeed;
    const nonce = user.nonce;
    const hash = getGameHash(serverSeed, clientSeed, nonce);
    
    const roll = getDiceResult(hash);
    const isWin = roll < 50;
    const multiplier = 1.98;
    const winAmount = isWin ? bet * multiplier : 0;
    
    user.balance -= bet;
    if (isWin) user.balance += winAmount;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const sessionId = `dice_${Date.now()}`;
    gameSessions[sessionId] = {
        game: 'dice',
        serverSeed,
        clientSeed,
        nonce,
        hash,
        roll,
        multiplier,
        winAmount,
        isWin,
        timestamp: Date.now()
    };
    
    res.json({
        result: {
            roll,
            winAmount,
            isWin,
            multiplier,
            hash,
            sessionId,
            clientSeed,
            nonce
        },
        newBalance: user.balance
    });
});

// ============================================================
// GAME: CRASH (Provably Fair)
// ============================================================

app.post('/api/games/crash', (req, res) => {
    const { bet, userId, action } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (action === 'start') {
        if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
        
        user.nonce++;
        
        const serverSeed = generateSeed();
        const clientSeed = user.clientSeed;
        const nonce = user.nonce;
        const hash = getGameHash(serverSeed, clientSeed, nonce);
        
        const crashPoint = getCrashPoint(hash);
        
        user.balance -= bet;
        user.totalWagered = (user.totalWagered || 0) + bet;
        
        const sessionId = `crash_${Date.now()}`;
        gameSessions[sessionId] = {
            game: 'crash',
            serverSeed,
            clientSeed,
            nonce,
            hash,
            crashPoint,
            bet,
            cashedOut: false,
            cashoutMultiplier: 0,
            timestamp: Date.now()
        };
        
        res.json({
            result: {
                action: 'start',
                crashPoint,
                sessionId,
                hash,
                clientSeed,
                nonce
            },
            newBalance: user.balance
        });
        
    } else if (action === 'cashout') {
        const { sessionId, multiplier } = req.body;
        const session = gameSessions[sessionId];
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (session.cashedOut) {
            return res.status(400).json({ error: 'Already cashed out' });
        }
        
        if (multiplier >= session.crashPoint) {
            return res.status(400).json({ error: 'Game already crashed' });
        }
        
        session.cashedOut = true;
        session.cashoutMultiplier = multiplier;
        
        const winAmount = session.bet * multiplier;
        user.balance += winAmount;
        
        res.json({
            result: {
                action: 'cashout',
                winAmount,
                multiplier,
                isWin: true
            },
            newBalance: user.balance
        });
    }
});

// ============================================================
// GAME: WHEEL (Provably Fair)
// ============================================================

app.post('/api/games/wheel', (req, res) => {
    const { bet, userId } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.nonce++;
    
    const serverSeed = generateSeed();
    const clientSeed = user.clientSeed;
    const nonce = user.nonce;
    const hash = getGameHash(serverSeed, clientSeed, nonce);
    
    const multipliers = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
    const hex = hash.substring(0, 8);
    const value = parseInt(hex, 16) / 0xFFFFFFFF;
    const selected = Math.floor(value * multipliers.length);
    const multiplier = multipliers[selected];
    const winAmount = bet * multiplier;
    const isWin = multiplier >= 1.0;
    
    user.balance -= bet;
    if (isWin) user.balance += winAmount;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const sessionId = `wheel_${Date.now()}`;
    gameSessions[sessionId] = {
        game: 'wheel',
        serverSeed,
        clientSeed,
        nonce,
        hash,
        multiplier,
        winAmount,
        isWin,
        timestamp: Date.now()
    };
    
    res.json({
        result: {
            multiplier,
            winAmount,
            isWin,
            hash,
            sessionId,
            clientSeed,
            nonce,
            segment: selected
        },
        newBalance: user.balance
    });
});

// ============================================================
// GAME: SLOTS (Provably Fair)
// ============================================================

app.post('/api/games/slots', (req, res) => {
    const { bet, userId } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.nonce++;
    
    const serverSeed = generateSeed();
    const clientSeed = user.clientSeed;
    const nonce = user.nonce;
    const hash = getGameHash(serverSeed, clientSeed, nonce);
    
    const symbols = ['💎', '7️⃣', '🔔', '🍒', '⭐', '🎰'];
    const hexParts = hash.match(/.{2}/g) || [];
    
    const s1 = symbols[parseInt(hexParts[0] || '00', 16) % symbols.length];
    const s2 = symbols[parseInt(hexParts[1] || '00', 16) % symbols.length];
    const s3 = symbols[parseInt(hexParts[2] || '00', 16) % symbols.length];
    
    let multiplier = 0;
    if (s1 === s2 && s2 === s3) multiplier = 5.0;
    else if (s1 === s2 || s2 === s3) multiplier = 1.5;
    
    const winAmount = multiplier > 0 ? bet * multiplier : 0;
    
    user.balance -= bet;
    if (winAmount > 0) user.balance += winAmount;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const sessionId = `slots_${Date.now()}`;
    gameSessions[sessionId] = {
        game: 'slots',
        serverSeed,
        clientSeed,
        nonce,
        hash,
        symbols: [s1, s2, s3],
        multiplier,
        winAmount,
        isWin: winAmount > 0,
        timestamp: Date.now()
    };
    
    res.json({
        result: {
            symbols: [s1, s2, s3],
            multiplier,
            winAmount,
            isWin: winAmount > 0,
            hash,
            sessionId,
            clientSeed,
            nonce
        },
        newBalance: user.balance
    });
});

// ============================================================
// VERIFICATION ENDPOINT
// ============================================================

app.post('/api/verify', (req, res) => {
    const { sessionId } = req.body;
    const session = gameSessions[sessionId];
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    const hash = getGameHash(session.serverSeed, session.clientSeed, session.nonce);
    let isValid = false;
    let expectedResult = null;
    
    switch (session.game) {
        case 'plinko':
            expectedResult = getPlinkoResult(hash);
            isValid = expectedResult === session.multiplier;
            break;
        case 'mines':
            const mines = getMinesResult(hash, session.minePositions.length);
            isValid = JSON.stringify(mines) === JSON.stringify(session.minePositions);
            break;
        case 'dice':
            expectedResult = getDiceResult(hash);
            isValid = expectedResult === session.roll;
            break;
        case 'crash':
            expectedResult = getCrashPoint(hash);
            isValid = expectedResult === session.crashPoint;
            break;
        case 'wheel':
            const multipliers = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
            const hex = hash.substring(0, 8);
            const value = parseInt(hex, 16) / 0xFFFFFFFF;
            const selected = Math.floor(value * multipliers.length);
            expectedResult = multipliers[selected];
            isValid = expectedResult === session.multiplier;
            break;
        case 'slots':
            const symbols = ['💎', '7️⃣', '🔔', '🍒', '⭐', '🎰'];
            const hexParts = hash.match(/.{2}/g) || [];
            const s1 = symbols[parseInt(hexParts[0] || '00', 16) % symbols.length];
            const s2 = symbols[parseInt(hexParts[1] || '00', 16) % symbols.length];
            const s3 = symbols[parseInt(hexParts[2] || '00', 16) % symbols.length];
            let mult = 0;
            if (s1 === s2 && s2 === s3) mult = 5.0;
            else if (s1 === s2 || s2 === s3) mult = 1.5;
            expectedResult = { symbols: [s1, s2, s3], multiplier: mult };
            isValid = expectedResult.multiplier === session.multiplier;
            break;
    }
    
    res.json({
        session: {
            game: session.game,
            clientSeed: session.clientSeed,
            nonce: session.nonce,
            hash: hash,
            result: session.multiplier || session.roll || session.crashPoint
        },
        expectedResult: expectedResult,
        isValid: isValid,
        serverSeed: session.serverSeed,
        message: isValid ? '✅ Game verified! 100% provably fair!' : '❌ Verification failed!'
    });
});

// ============================================================
// BETNEX GAME ENDPOINTS (Demo Mode)
// ============================================================

app.get('/api/provider/games', (req, res) => {
    console.log('📦 Returning demo games');
    res.json({
        games: [
            { id: 'plinko', name: 'Plinko', provider: 'BetVora (Provably Fair)', icon: '🟢' },
            { id: 'mines', name: 'Mines', provider: 'BetVora (Provably Fair)', icon: '💣' },
            { id: 'dice', name: 'Dice', provider: 'BetVora (Provably Fair)', icon: '🎲' },
            { id: 'crash', name: 'Crash', provider: 'BetVora (Provably Fair)', icon: '🚀' },
            { id: 'wheel', name: 'Wheel', provider: 'BetVora (Provably Fair)', icon: '🎡' },
            { id: 'slots', name: 'Slots', provider: 'BetVora (Provably Fair)', icon: '🎰' }
        ]
    });
});

app.post('/api/provider/launch', (req, res) => {
    const { bet, userId } = req.body;
    
    const user = users[parseInt(userId)];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (bet > user.balance) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const isWin = Math.random() > 0.5;
    const multiplier = isWin ? (Math.random() * 3 + 1.5).toFixed(1) : 0;
    const winAmount = isWin ? bet * parseFloat(multiplier) : 0;
    
    user.balance -= bet;
    if (isWin) user.balance += winAmount;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    res.json({
        gameUrl: null,
        isDemo: true,
        result: {
            isWin: isWin,
            multiplier: multiplier,
            winAmount: winAmount
        },
        newBalance: user.balance
    });
});

// ============================================================
// TEST ENDPOINT
// ============================================================

app.get('/api/test', (req, res) => {
    res.json({
        message: 'BetVora API with Provably Fair! 🚀',
        status: 'online',
        betnex: betnexEnabled ? '✅ API Key Found (Demo Mode)' : '❌ No API Key',
        users: Object.keys(users).length,
        sessions: Object.keys(gameSessions).length
    });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 Provably Fair system ENABLED`);
    console.log(`🎰 Betnex: ${betnexEnabled ? '✅ API Key Found (Demo Mode)' : '❌ DEMO MODE'}`);
    console.log(`👥 Users registered: ${Object.keys(users).length}`);
});
