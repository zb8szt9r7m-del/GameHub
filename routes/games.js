const express = require('express');
const { getDb } = require('../database/database');
const { authMiddleware } = require('./auth');

const router = express.Router();

router.get('/leaderboard', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.username, u.coins,
      COUNT(CASE WHEN m.winner = u.username THEN 1 END) as wins,
      COUNT(CASE WHEN (m.player1 = u.username OR m.player2 = u.username) AND m.winner IS NOT NULL THEN 1 END) as total_games
    FROM users u
    LEFT JOIN matches m ON m.player1 = u.username OR m.player2 = u.username
    WHERE u.is_banned = 0 AND u.is_admin = 0
    GROUP BY u.id
    ORDER BY wins DESC, u.coins DESC
    LIMIT 10
  `).all();
  res.json(users);
});

router.get('/history', authMiddleware, (req, res) => {
  const db = getDb();
  const username = req.user.username;
  const matches = db.prepare(`
    SELECT * FROM matches WHERE player1 = ? OR player2 = ? ORDER BY created_at DESC LIMIT 20
  `).all(username, username);
  res.json(matches);
});

router.post('/record', authMiddleware, (req, res) => {
  const { game, opponent, winner, isRanked } = req.body;
  const db = getDb();
  const username = req.user.username;

  const match = db.prepare('INSERT INTO matches (game, player1, player2, winner, is_ranked, ended_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run(game, username, opponent || 'AI', winner, isRanked ? 1 : 0);

  if (winner === username) {
    const reward = isRanked ? 50 : 20;
    db.prepare('UPDATE users SET coins = coins + ? WHERE username = ?').run(reward, username);
    db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES ((SELECT id FROM users WHERE username = ?), ?, ?)').run(username, reward, `Win reward: ${game}`);
  }
  if (isRanked) {
    db.prepare('UPDATE users SET coins = coins - 25 WHERE username = ?').run(username);
    db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES ((SELECT id FROM users WHERE username = ?), -25, ?)').run(username, `Ranked match entry: ${game}`);
  }

  const user = db.prepare('SELECT coins FROM users WHERE username = ?').get(username);
  res.json({ success: true, newBalance: user?.coins });
});

module.exports = router;
