const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== IN-MEMORY DATABASE ==========
// This works on Render without needing SQLite
const users = {};
let idCounter = 1;

// ========== TEST ENDPOINT ==========
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'BetVora API is running! 🚀',
    status: 'online',
    users: Object.keys(users).length
  });
});

// ========== AUTH ENDPOINTS ==========
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  // Check if email already exists
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
    createdAt: new Date().toISOString()
  };
  
  res.json({ 
    success: true, 
    userId: id,
    username: username,
    balance: 100
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  const user = Object.values(users).find(u => u.email === email && u.password === password);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  res.json({
    success: true,
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance
  });
});

app.get('/api/user/:id/balance', (req, res) => {
  const user = users[parseInt(req.params.id)];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ balance: user.balance });
});

// ========== GAME: PLINKO ==========
app.post('/api/games/plinko', (req, res) => {
  const { bet, userId } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  
  user.balance -= bet;
  user.totalWagered = (user.totalWagered || 0) + bet;
  
  const multipliers = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
  const weights = [20, 25, 20, 15, 10, 7, 3];
  let totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  let selected = 0;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) { selected = i; break; }
  }
  
  const multiplier = multipliers[selected];
  const winAmount = bet * multiplier;
  const isWin = multiplier >= 1.0;
  
  if (isWin) {
    user.balance += winAmount;
  }
  
  res.json({
    result: {
      multiplier: multiplier,
      winAmount: isWin ? winAmount : 0,
      isWin: isWin
    },
    newBalance: user.balance
  });
});

// ========== GAME: MINES ==========
app.post('/api/games/mines', (req, res) => {
  const { bet, userId, bombs, revealCount } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  
  user.balance -= bet;
  user.totalWagered = (user.totalWagered || 0) + bet;
  
  const bombCount = bombs || 5;
  const revealed = revealCount || 0;
  
  // Simulate mine pick
  const isBomb = Math.random() < (bombCount / 25);
  
  if (isBomb) {
    res.json({
      result: {
        isBomb: true,
        winAmount: 0,
        isWin: false
      },
      newBalance: user.balance
    });
  } else {
    const multiplier = 1 + (revealed + 1) * 0.2;
    const winAmount = bet * multiplier;
    user.balance += winAmount;
    
    res.json({
      result: {
        isBomb: false,
        winAmount: winAmount,
        isWin: true,
        multiplier: multiplier
      },
      newBalance: user.balance
    });
  }
});

// ========== GAME: DICE ==========
app.post('/api/games/dice', (req, res) => {
  const { bet, userId } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  
  user.balance -= bet;
  user.totalWagered = (user.totalWagered || 0) + bet;
  
  const roll = Math.random() * 100;
  const isWin = roll < 50;
  const multiplier = 1.98;
  const winAmount = isWin ? bet * multiplier : 0;
  
  if (isWin) {
    user.balance += winAmount;
  }
  
  res.json({
    result: {
      roll: roll,
      multiplier: multiplier,
      winAmount: winAmount,
      isWin: isWin
    },
    newBalance: user.balance
  });
});

// ========== GAME: SLOTS ==========
app.post('/api/games/slots', (req, res) => {
  const { bet, userId } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  
  user.balance -= bet;
  user.totalWagered = (user.totalWagered || 0) + bet;
  
  const symbols = ['💎', '7️⃣', '🔔', '🍒', '⭐', '🎰'];
  const s1 = symbols[Math.floor(Math.random() * symbols.length)];
  const s2 = symbols[Math.floor(Math.random() * symbols.length)];
  const s3 = symbols[Math.floor(Math.random() * symbols.length)];
  
  let multiplier = 0;
  if (s1 === s2 && s2 === s3) multiplier = 5.0;
  else if (s1 === s2 || s2 === s3) multiplier = 1.5;
  
  const winAmount = multiplier > 0 ? bet * multiplier : 0;
  
  if (winAmount > 0) {
    user.balance += winAmount;
  }
  
  res.json({
    result: {
      symbols: [s1, s2, s3],
      multiplier: multiplier,
      winAmount: winAmount,
      isWin: winAmount > 0
    },
    newBalance: user.balance
  });
});

// ========== GAME: CRASH ==========
app.post('/api/games/crash', (req, res) => {
  const { bet, userId, action } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  if (action === 'start') {
    if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= bet;
    user.totalWagered = (user.totalWagered || 0) + bet;
    
    const crashPoint = 1.0 + Math.random() * 14;
    
    res.json({
      result: {
        action: 'start',
        crashPoint: crashPoint,
        bet: bet
      },
      newBalance: user.balance
    });
  } else if (action === 'cashout') {
    const { multiplier } = req.body;
    const winAmount = bet * multiplier;
    user.balance += winAmount;
    
    res.json({
      result: {
        action: 'cashout',
        winAmount: winAmount,
        multiplier: multiplier,
        isWin: true
      },
      newBalance: user.balance
    });
  }
});

// ========== GAME: WHEEL ==========
app.post('/api/games/wheel', (req, res) => {
  const { bet, userId } = req.body;
  
  const user = users[parseInt(userId)];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (bet > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  
  user.balance -= bet;
  user.totalWagered = (user.totalWagered || 0) + bet;
  
  const multipliers = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
  const weights = [20, 25, 20, 15, 10, 7, 3];
  let totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  let selected = 0;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) { selected = i; break; }
  }
  
  const multiplier = multipliers[selected];
  const winAmount = bet * multiplier;
  const isWin = multiplier >= 1.0;
  
  if (isWin) {
    user.balance += winAmount;
  }
  
  res.json({
    result: {
      multiplier: multiplier,
      winAmount: isWin ? winAmount : 0,
      isWin: isWin,
      segment: selected
    },
    newBalance: user.balance
  });
});

// ========== BETNEX PLACEHOLDER (Coming Soon) ==========
app.get('/api/provider/games', (req, res) => {
  res.json({
    games: [
      { id: 'plinko', name: 'Plinko', provider: 'BetVora', icon: '🟢' },
      { id: 'mines', name: 'Mines', provider: 'BetVora', icon: '💣' },
      { id: 'dice', name: 'Dice', provider: 'BetVora', icon: '🎲' },
      { id: 'slots', name: 'Slots', provider: 'BetVora', icon: '🎰' },
      { id: 'crash', name: 'Crash', provider: 'BetVora', icon: '🚀' },
      { id: 'wheel', name: 'Wheel', provider: 'BetVora', icon: '🎡' }
    ]
  });
});

app.post('/api/provider/launch', (req, res) => {
  res.json({
    gameUrl: null,
    isDemo: true,
    message: 'Betnex not configured yet'
  });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`👥 Users registered: ${Object.keys(users).length}`);
  console.log(`🔗 API: http://localhost:${PORT}/api/test`);
});
