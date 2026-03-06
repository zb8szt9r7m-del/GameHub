# 🎮 GameHub — Multiplayer Game Platform

A full-stack multiplayer game hub built with Node.js, Express, Socket.io, and SQLite.

---

## 🚀 Quick Start

```bash
npm install
npm start
```

Then open: **http://localhost:3000**

---

## 🔐 Default Admin Account

- **Username:** `admin`
- **Password:** `password`
- **Admin Panel:** http://localhost:3000/admin

---

## 📁 Project Structure

```
gamehub/
├── server.js              # Main server + Socket.io multiplayer
├── package.json
├── database/
│   ├── database.js        # SQLite connection (auto-creates DB)
│   └── schema.sql         # DB schema + default admin user
├── game_logic/
│   ├── checkers.js        # Full checkers engine with AI (minimax)
│   └── durak.js           # Full Durak card game engine with AI
├── routes/
│   ├── auth.js            # Register/Login/Logout (JWT + bcrypt)
│   ├── coins.js           # Daily rewards, shop, admin grants
│   └── games.js           # Leaderboard, match history, recording
└── public/
    ├── index.html         # Main lobby
    ├── js/app.js          # Frontend logic
    ├── games/
    │   ├── checkers.html  # Checkers game UI
    │   └── durak.html     # Durak card game UI
    └── admin/
        └── admin.html     # Admin dashboard
```

---

## 🎮 Features

### Authentication
- Register / Login / Logout
- Passwords hashed with bcrypt
- JWT tokens (7-day expiry, stored in HTTP-only cookies)
- Session persists across page refreshes

### Games
**Checkers**
- Play vs AI (minimax depth 3 with alpha-beta pruning)
- Play vs online opponent (Socket.io rooms)
- King promotion with animation
- Mandatory capture enforcement
- Multi-capture chains
- Move highlighting

**Durak** (Russian card game)
- Play vs AI (smart decision making)
- Play vs online opponent
- Full rule implementation (attack, defend, take, end turn)
- Trump suit system
- 36-card deck

### Multiplayer (Socket.io)
- Quick Match (auto-matchmaking)
- Create Room (shareable room code)
- Join Room (enter code)
- Server-side game state validation
- Opponent disconnect detection

### Coin Economy
- New players: **2,500 coins**
- Daily reward: **500 coins**
- Win (casual): **+20 coins**
- Win (ranked): **+50 coins**
- Ranked entry: **-25 coins**
- Shop: 5,000 / 15,000 / 50,000 coin packs (simulated)

### Admin Panel (`/admin`)
- View all users
- Grant coins to users
- Ban / Unban users
- View all matches
- View all transactions
- Platform stats

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Realtime | Socket.io |
| Database | SQLite via better-sqlite3 |
| Auth | JWT + bcrypt |
| Frontend | Vanilla HTML/CSS/JS |
| Fonts | Google Fonts (Orbitron + Rajdhani) |

---

## 🌐 Replit Setup

1. Import the project
2. Run `npm install` in the Shell
3. Run `npm start`
4. Click the webview URL

The `.replit` file is not included — just set run command to `npm start`.

---

## 📝 Notes

- Database is auto-created at `database/gamehub.db` on first run
- No external services required — runs fully offline
- Admin password hash in schema.sql is bcrypt of `"password"`
