const express = require('express');
const { getDb } = require('../database/database');
const { authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

// Daily reward
router.post('/daily', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare(`SELECT id FROM daily_rewards WHERE user_id = ? AND date(claimed_at) = date('now')`).get(userId);
  if (existing) return res.status(400).json({ error: 'Already claimed today', nextClaim: 'tomorrow' });

  const amount = 500;
  db.prepare('INSERT INTO daily_rewards (user_id) VALUES (?)').run(userId);
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, userId);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(userId, amount, 'Daily reward');
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
  res.json({ success: true, amount, newBalance: user.coins });
});

// Shop purchase (simulated)
router.post('/purchase', authMiddleware, (req, res) => {
  const { pack } = req.body;
  const packs = { basic: 5000, standard: 15000, premium: 50000 };
  if (!packs[pack]) return res.status(400).json({ error: 'Invalid pack' });

  const db = getDb();
  const amount = packs[pack];
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, req.user.id);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(req.user.id, amount, `Shop purchase: ${pack} pack`);
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, amount, newBalance: user.coins });
});

// Get transaction history
router.get('/history', authMiddleware, (req, res) => {
  const db = getDb();
  const txns = db.prepare('SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json(txns);
});

// Admin: grant coins
router.post('/admin/grant', adminMiddleware, (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount) return res.status(400).json({ error: 'Username and amount required' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, user.id);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(user.id, amount, 'Admin grant');
  res.json({ success: true });
});

module.exports = router;
