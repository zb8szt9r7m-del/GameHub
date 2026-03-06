// GameHub Frontend App Logic
const API = '';
let currentUser = null;
let socket = null;
let selectedGame = null;
let gameMode = 'ai';
let onlineMode = 'quick';
let pendingRoomId = null;

// ===== AUTH =====
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  err.style.display = 'none';
  try {
    const res = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.style.display = 'block'; return; }
    currentUser = data;
    showApp();
  } catch { err.textContent = 'Connection error'; err.style.display = 'block'; }
}

async function doRegister() {
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value;
  const err = document.getElementById('regError');
  err.style.display = 'none';
  try {
    const res = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.style.display = 'block'; return; }
    currentUser = data;
    showApp();
  } catch { err.textContent = 'Connection error'; err.style.display = 'block'; }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method:'POST' });
  if (socket) socket.disconnect();
  location.reload();
}

function goAdmin() { window.location.href = '/admin'; }

// ===== APP =====
function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('navUsername').textContent = currentUser.username;
  document.getElementById('coinBalance').textContent = currentUser.coins?.toLocaleString() || 0;
  if (currentUser.isAdmin) document.getElementById('adminBtn').style.display = 'inline-block';
  initSocket();
  loadLeaderboard();
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      currentUser = await res.json();
      showApp();
    }
  } catch {}
}

// ===== SOCKET =====
function initSocket() {
  socket = io({ auth: {} });
  socket.on('onlineCount', n => { document.getElementById('onlineCount').textContent = n; });
  socket.on('roomCreated', ({ roomId }) => {
    pendingRoomId = roomId;
    document.getElementById('roomCodeDisplay').style.display = 'block';
    document.getElementById('roomCodeValue').textContent = roomId;
  });
  socket.on('error', msg => showToast('Error', msg, 'error'));
  socket.on('waiting', ({ message }) => showToast('Matchmaking', message));
}

// ===== LEADERBOARD =====
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/games/leaderboard');
    const data = await res.json();
    const lb = document.getElementById('leaderboard');
    if (!data.length) { lb.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px">No players yet</p>'; return; }
    lb.innerHTML = data.map((u, i) => `
      <div class="lb-item">
        <div class="lb-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i+1}</div>
        <div class="lb-info">
          <div class="lb-name">${u.username}</div>
          <div class="lb-stats">${u.wins || 0} wins Â· ${u.total_games || 0} games</div>
        </div>
        <div class="lb-coins">ðª ${u.coins?.toLocaleString()}</div>
      </div>
    `).join('');
  } catch {}
}

// ===== DAILY REWARD =====
async function claimDaily() {
  const btn = document.getElementById('dailyBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/coins/daily', { method:'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast('Already Claimed', data.error, 'error');
      return;
    }
    currentUser.coins = data.newBalance;
    document.getElementById('coinBalance').textContent = data.newBalance?.toLocaleString();
    showToast('Daily Reward!', `+${data.amount} coins claimed! ð`, 'success');
  } catch { btn.disabled = false; }
}

// ===== SHOP =====
async function buyCoins(pack) {
  const names = { basic:'5,000 coins', standard:'15,000 coins', premium:'50,000 coins' };
  if (!confirm(`Purchase ${names[pack]}? (Simulated payment)`)) return;
  try {
    const res = await fetch('/api/coins/purchase', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pack}) });
    const data = await res.json();
    if (!res.ok) { showToast('Error', data.error, 'error'); return; }
    currentUser.coins = data.newBalance;
    document.getElementById('coinBalance').textContent = data.newBalance?.toLocaleString();
    showToast('Purchase Complete!', `+${data.amount.toLocaleString()} coins added!`, 'success');
  } catch { showToast('Error', 'Purchase failed', 'error'); }
}

// ===== GAME MODAL =====
function openGameModal(game) {
  selectedGame = game;
  gameMode = 'ai';
  onlineMode = 'quick';
  pendingRoomId = null;
  document.getElementById('modalTitle').textContent = game.toUpperCase() + ' â SELECT MODE';
  document.getElementById('optVsAI').classList.add('selected');
  document.getElementById('optOnline').classList.remove('selected');
  document.getElementById('onlineOptions').style.display = 'none';
  document.getElementById('joinRoomInput').style.display = 'none';
  document.getElementById('roomCodeDisplay').style.display = 'none';
  document.getElementById('joinRoomInput').value = '';
  document.getElementById('gameModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('gameModal').style.display = 'none';
  if (socket && pendingRoomId) socket.emit('cancelWaiting', { game: selectedGame });
}

function selectMode(mode) {
  gameMode = mode;
  document.getElementById('optVsAI').classList.toggle('selected', mode === 'ai');
  document.getElementById('optOnline').classList.toggle('selected', mode === 'online');
  document.getElementById('onlineOptions').style.display = mode === 'online' ? 'block' : 'none';
  if (mode === 'online') {
    document.getElementById('btnQuick').style.fontWeight = '700';
    document.getElementById('btnCreate').style.fontWeight = '400';
    document.getElementById('btnJoin').style.fontWeight = '400';
  }
}

function selectOnlineMode(mode) {
  onlineMode = mode;
  ['quick','create','join'].forEach(m => {
    document.getElementById('btn'+m.charAt(0).toUpperCase()+m.slice(1)).style.fontWeight = m === mode ? '700' : '400';
  });
  document.getElementById('joinRoomInput').style.display = mode === 'join' ? 'block' : 'none';
  document.getElementById('roomCodeDisplay').style.display = 'none';
}

function launchGame() {
  if (gameMode === 'ai') {
    closeModal();
    window.location.href = `/game/${selectedGame}?mode=ai`;
    return;
  }
  // Online
  if (onlineMode === 'quick') {
    socket.emit('quickMatch', { game: selectedGame });
    socket.once('checkersStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    socket.once('durakStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    showToast('Matchmaking', 'Finding opponent...');
    return;
  }
  if (onlineMode === 'create') {
    socket.emit('createRoom', { game: selectedGame });
    socket.once('checkersStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    socket.once('durakStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    return;
  }
  if (onlineMode === 'join') {
    const code = document.getElementById('joinRoomInput').value.trim().toUpperCase();
    if (!code) { showToast('Error', 'Enter a room code', 'error'); return; }
    socket.emit('joinRoom', { roomId: code });
    socket.once('checkersStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    socket.once('durakStart', () => { closeModal(); window.location.href = `/game/${selectedGame}?mode=online`; });
    return;
  }
}

// ===== TOAST =====
let toastTimer;
function showToast(title, msg, type = 'info') {
  const t = document.getElementById('toast');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMsg').textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// Enter key support
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('loginForm').style.display !== 'none') doLogin();
    else doRegister();
  }
});

// Init
checkAuth();
