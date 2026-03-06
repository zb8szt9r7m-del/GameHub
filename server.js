const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('./database/database');
const { router: authRouter, authMiddleware, adminMiddleware, JWT_SECRET } = require('./routes/auth');
const coinsRouter = require('./routes/coins');
const gamesRouter = require('./routes/games');
const checkers = require('./game_logic/checkers');
const durak = require('./game_logic/durak');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', credentials: true } });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/coins', coinsRouter);
app.use('/api/games', gamesRouter);

// Admin routes
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, coins, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});
app.post('/api/admin/ban', adminMiddleware, (req, res) => {
  const { username, banned } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET is_banned = ? WHERE username = ?').run(banned ? 1 : 0, username);
  res.json({ success: true });
});
app.get('/api/admin/matches', adminMiddleware, (req, res) => {
  const db = getDb();
  const matches = db.prepare('SELECT * FROM matches ORDER BY created_at DESC LIMIT 50').all();
  res.json(matches);
});
app.get('/api/admin/transactions', adminMiddleware, (req, res) => {
  const db = getDb();
  const txns = db.prepare(`
    SELECT ct.*, u.username FROM coin_transactions ct
    JOIN users u ON ct.user_id = u.id
    ORDER BY ct.created_at DESC LIMIT 100
  `).all();
  res.json(txns);
});
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get().c;
  const matchCount = db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
  const totalCoins = db.prepare('SELECT SUM(coins) as c FROM users WHERE is_admin = 0').get().c || 0;
  res.json({ userCount, matchCount, totalCoins });
});

// Serve pages
app.get('/game/checkers', (req, res) => res.sendFile(path.join(__dirname, 'public/games/checkers.html')));
app.get('/game/durak', (req, res) => res.sendFile(path.join(__dirname, 'public/games/durak.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/admin.html')));

// ===== SOCKET.IO MULTIPLAYER =====
const rooms = new Map(); // roomId -> room state
const waitingPlayers = { checkers: null, durak: null };

function getUserFromSocket(socket) {
  try {
    // Try JWT from cookie header first
    const cookieHeader = socket.handshake.headers?.cookie || '';
    const tokenMatch = cookieHeader.match(/token=([^;]+)/);
    if (tokenMatch) {
      return jwt.verify(tokenMatch[1], JWT_SECRET);
    }
    // Fallback: username from handshake auth (validate exists in DB)
    const username = socket.handshake.auth?.username;
    if (username) {
      const db = getDb();
      const user = db.prepare('SELECT id, username, is_admin, is_banned FROM users WHERE username = ?').get(username);
      if (user && !user.is_banned) return { id: user.id, username: user.username, isAdmin: user.is_admin };
    }
    return null;
  } catch (e) { console.error('getUserFromSocket error:', e.message); return null; }
}

io.on('connection', (socket) => {
  const user = getUserFromSocket(socket);
  if (!user) { socket.disconnect(); return; }
  socket.username = user.username;
  socket.userId = user.id;

  console.log(`[Socket] ${user.username} connected`);

  // Online player count
  const onlineCount = io.sockets.sockets.size;
  io.emit('onlineCount', onlineCount);

  // ===== ROOM MANAGEMENT =====
  socket.on('createRoom', ({ game, isRanked }) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    rooms.set(roomId, {
      id: roomId, game, isRanked: !!isRanked,
      players: [{ socket, username: socket.username }],
      state: null, started: false
    });
    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.emit('roomCreated', { roomId, game });
  });

  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.players.length >= 2) { socket.emit('error', 'Room is full'); return; }
    if (room.started) { socket.emit('error', 'Game already started'); return; }

    room.players.push({ socket, username: socket.username });
    socket.join(roomId.toUpperCase());
    socket.currentRoom = roomId.toUpperCase();
    startMultiplayerGame(room);
  });

  socket.on('quickMatch', ({ game }) => {
    if (waitingPlayers[game] && waitingPlayers[game].username !== socket.username) {
      const opponent = waitingPlayers[game];
      waitingPlayers[game] = null;
      const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
      const room = {
        id: roomId, game, isRanked: false,
        players: [{ socket: opponent, username: opponent.username }, { socket, username: socket.username }],
        state: null, started: false
      };
      rooms.set(roomId, room);
      opponent.join(roomId);
      socket.join(roomId);
      opponent.currentRoom = roomId;
      socket.currentRoom = roomId;
      startMultiplayerGame(room);
    } else {
      waitingPlayers[game] = socket;
      socket.emit('waiting', { message: 'Waiting for opponent...' });
    }
  });

  socket.on('cancelWaiting', ({ game }) => {
    if (waitingPlayers[game]?.username === socket.username) waitingPlayers[game] = null;
  });

  // ===== ROOM REJOIN (after page navigation) =====
  socket.on('rejoinRoom', ({ roomId, username }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) {
      socket.emit('error', 'Room not found or expired. Please start a new game.');
      return;
    }

    // Find the player in the room by username and update their socket
    const playerIdx = room.players.findIndex(p => p.username === username);
    if (playerIdx === -1) {
      socket.emit('error', 'You are not in this room.');
      return;
    }

    // Update socket reference
    room.players[playerIdx].socket = socket;
    socket.join(roomId.toUpperCase());
    socket.currentRoom = roomId.toUpperCase();
    socket.username = username;

    console.log(`[Socket] ${username} rejoined room ${roomId}`);

    if (room.game === 'checkers' && room.state) {
      const state = room.state.checkers;
      socket.emit('checkersRejoin', {
        board: state.board,
        isRedTurn: state.isRedTurn,
        mySide: playerIdx === 0 ? 'red' : 'black',
        players: {
          red: room.players[0].username,
          black: room.players[1]?.username || 'Waiting...'
        }
      });
    } else if (room.game === 'durak' && room.state) {
      const state = room.state.durak;
      const publicState = durak.getPublicState(state, playerIdx);
      socket.emit('durakRejoin', { ...publicState, myIndex: playerIdx });
    }
  });

  // ===== CHECKERS MOVES =====
  socket.on('checkersMove', ({ roomId, move }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room || room.game !== 'checkers') { socket.emit('moveError', 'Room not found'); return; }
    const state = room.state;
    const playerIdx = room.players.findIndex(p => p.username === socket.username);
    const side = playerIdx === 0 ? 'red' : 'black';

    const result = checkers.validateMove(state.checkers, move, side);
    if (!result.valid) { socket.emit('moveError', result.reason); return; }

    state.checkers.board = result.newBoard;
    state.checkers.isRedTurn = result.nextTurn;

    const update = { board: result.newBoard, isRedTurn: result.nextTurn, lastMove: result.move, chainCapture: result.chainCapture };
    if (result.winner) {
      update.winner = result.winner === 'red' ? room.players[0].username : room.players[1].username;
      recordMatchResult(room, update.winner);
    }
    io.to(room.id).emit('checkersUpdate', update);
  });

  // ===== DURAK ACTIONS =====
  socket.on('durakAction', ({ roomId, action, ...data }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room || room.game !== 'durak') { socket.emit('moveError', 'Room not found'); return; }
    const state = room.state.durak;
    const playerIdx = room.players.findIndex(p => p.username === socket.username);

    let result;
    if (action === 'attack') result = durak.attack(state, playerIdx, data.card);
    else if (action === 'defend') result = durak.defend(state, playerIdx, data.attackCard, data.defendCard);
    else if (action === 'take') result = durak.take(state, playerIdx);
    else if (action === 'endTurn') result = durak.endTurn(state, playerIdx);
    else return;

    if (!result.ok) { socket.emit('moveError', result.reason); return; }

    sendDurakState(room);

    if (state.phase === 'done') {
      const winner = state.winner === 'player1' ? room.players[0].username : state.winner === 'player2' ? room.players[1].username : null;
      recordMatchResult(room, winner);
    }
  });

  // ===== AI GAMES =====
  socket.on('startAIGame', ({ game }) => {
    if (game === 'checkers') {
      const state = { board: checkers.createInitialBoard(), isRedTurn: true };
      socket.aiGame = { game: 'checkers', state, playerSide: 'red' };
      socket.emit('checkersAIStart', { board: state.board, playerSide: 'red', isRedTurn: true });
    } else if (game === 'durak') {
      const state = durak.createGame();
      socket.aiGame = { game: 'durak', state, playerIdx: state.attacker };
      socket.emit('durakAIStart', durak.getPublicState(state, socket.aiGame.playerIdx));
      // If AI goes first
      if (state.attacker !== socket.aiGame.playerIdx) {
        setTimeout(() => doAITurn(socket), 800);
      }
    }
  });

  socket.on('checkersAIMove', ({ move }) => {
    if (!socket.aiGame || socket.aiGame.game !== 'checkers') return;
    const state = socket.aiGame.state;
    const result = checkers.validateMove(state, move, 'red');
    if (!result.valid) { socket.emit('moveError', result.reason); return; }

    state.board = result.newBoard;
    state.isRedTurn = result.nextTurn;
    socket.emit('checkersAIUpdate', { board: state.board, isRedTurn: state.isRedTurn, lastMove: result.move, chainCapture: result.chainCapture });

    if (result.winner) {
      socket.emit('checkersAIUpdate', { board: state.board, isRedTurn: state.isRedTurn, winner: result.winner === 'red' ? 'You' : 'AI' });
      return;
    }
    if (!result.chainCapture && !state.isRedTurn) {
      setTimeout(() => doCheckersAITurn(socket), 600);
    }
  });

  socket.on('durakAIAction', ({ action, ...data }) => {
    if (!socket.aiGame || socket.aiGame.game !== 'durak') return;
    const state = socket.aiGame.state;
    const playerIdx = socket.aiGame.playerIdx;

    let result;
    if (action === 'attack') result = durak.attack(state, playerIdx, data.card);
    else if (action === 'defend') result = durak.defend(state, playerIdx, data.attackCard, data.defendCard);
    else if (action === 'take') result = durak.take(state, playerIdx);
    else if (action === 'endTurn') result = durak.endTurn(state, playerIdx);
    else return;

    if (!result.ok) { socket.emit('moveError', result.reason); return; }

    socket.emit('durakAIUpdate', durak.getPublicState(state, playerIdx));
    if (state.phase === 'done') return;
    if (state.attacker !== playerIdx || state.phase === 'attack') {
      setTimeout(() => doAITurn(socket), 900);
    }
  });

  socket.on('disconnect', () => {
    // Clean waiting queue
    for (const game in waitingPlayers) {
      if (waitingPlayers[game]?.username === socket.username) waitingPlayers[game] = null;
    }
    // Give 10 seconds for reconnect before notifying room
    if (socket.currentRoom) {
      const roomId = socket.currentRoom;
      setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room) return;
        // Check if the player re-joined with a new socket
        const stillGone = !room.players.find(p => p.username === socket.username && p.socket.connected);
        if (stillGone && room.started) {
          io.to(roomId).emit('opponentLeft', { message: 'Opponent disconnected' });
          rooms.delete(roomId);
        }
      }, 10000);
    }
    io.emit('onlineCount', io.sockets.sockets.size);
    console.log(`[Socket] ${socket.username} disconnected`);
  });
});

function startMultiplayerGame(room) {
  room.started = true;
  if (room.game === 'checkers') {
    const board = checkers.createInitialBoard();
    room.state = { checkers: { board, isRedTurn: true } };
    // Send each player their side + room ID embedded in the start event
    room.players[0].socket.emit('checkersStart', {
      board,
      players: { red: room.players[0].username, black: room.players[1].username },
      isRedTurn: true,
      roomId: room.id,
      mySide: 'red'
    });
    room.players[1].socket.emit('checkersStart', {
      board,
      players: { red: room.players[0].username, black: room.players[1].username },
      isRedTurn: true,
      roomId: room.id,
      mySide: 'black'
    });
  } else if (room.game === 'durak') {
    const state = durak.createGame();
    room.state = { durak: state };
    room.players.forEach((p, i) => {
      const publicState = durak.getPublicState(state, i);
      p.socket.emit('durakStart', { ...publicState, roomId: room.id, mySide: i });
    });
  }
}

function sendDurakState(room) {
  const state = room.state.durak;
  room.players.forEach((p, i) => {
    p.socket.emit('durakUpdate', durak.getPublicState(state, i));
  });
}

function doCheckersAITurn(socket) {
  if (!socket.aiGame) return;
  const state = socket.aiGame.state;
  if (state.isRedTurn) return; // Player's turn
  const move = checkers.getAIMove(state.board);
  if (!move) {
    socket.emit('checkersAIUpdate', { board: state.board, isRedTurn: state.isRedTurn, winner: 'You' });
    return;
  }
  const result = checkers.validateMove(state, move, 'black');
  if (result.valid) {
    state.board = result.newBoard;
    state.isRedTurn = result.nextTurn;
    socket.emit('checkersAIUpdate', { board: state.board, isRedTurn: state.isRedTurn, lastMove: result.move, aiMove: true });
    if (result.winner) {
      socket.emit('checkersAIUpdate', { board: state.board, isRedTurn: state.isRedTurn, winner: result.winner === 'black' ? 'AI' : 'You' });
    } else if (!state.isRedTurn && !result.chainCapture) {
      setTimeout(() => doCheckersAITurn(socket), 600);
    }
  }
}

function doAITurn(socket) {
  if (!socket.aiGame || socket.aiGame.game !== 'durak') return;
  const state = socket.aiGame.state;
  const aiIdx = 1 - socket.aiGame.playerIdx;
  const action = durak.aiAction(state, aiIdx);
  if (!action) return;

  let result;
  if (action.action === 'attack') result = durak.attack(state, aiIdx, action.card);
  else if (action.action === 'defend') result = durak.defend(state, aiIdx, action.attackCard, action.defendCard);
  else if (action.action === 'take') result = durak.take(state, aiIdx);
  else if (action.action === 'endTurn') result = durak.endTurn(state, aiIdx);

  if (result?.ok) {
    socket.emit('durakAIUpdate', durak.getPublicState(state, socket.aiGame.playerIdx));
    if (state.phase !== 'done') {
      // Check if AI needs to act again
      const needsMore = (state.attacker === aiIdx && state.phase === 'attack') ||
                        (state.defender === aiIdx && state.phase === 'defense');
      if (needsMore) setTimeout(() => doAITurn(socket), 900);
    }
  }
}

function recordMatchResult(room, winner) {
  try {
    const db = getDb();
    const p1 = room.players[0]?.username;
    const p2 = room.players[1]?.username;
    db.prepare('INSERT INTO matches (game, player1, player2, winner, is_ranked, ended_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run(room.game, p1, p2, winner, room.isRanked ? 1 : 0);

    if (winner) {
      const reward = room.isRanked ? 50 : 20;
      db.prepare('UPDATE users SET coins = coins + ? WHERE username = ?').run(reward, winner);
      db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) SELECT id, ?, ? FROM users WHERE username = ?')
        .run(reward, `Win: ${room.game}`, winner);
    }
    if (room.isRanked) {
      for (const p of room.players) {
        db.prepare('UPDATE users SET coins = coins - 25 WHERE username = ? AND coins >= 25').run(p.username);
      }
    }
  } catch (e) { console.error('recordMatch error:', e); }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 GameHub running at http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
  console.log(`   Admin login: admin / password\n`);
  getDb(); // Initialize DB
});
