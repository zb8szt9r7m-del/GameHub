// Checkers game logic - server-side validation

const EMPTY = 0;
const RED = 1;
const BLACK = 2;
const RED_KING = 3;
const BLACK_KING = 4;

function createInitialBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = BLACK;
    }
  }
  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = RED;
    }
  }
  return board;
}

function isKing(piece) {
  return piece === RED_KING || piece === BLACK_KING;
}

function isRed(piece) {
  return piece === RED || piece === RED_KING;
}

function isBlack(piece) {
  return piece === BLACK || piece === BLACK_KING;
}

function getValidMoves(board, row, col, mustCapture = false) {
  const piece = board[row][col];
  if (piece === EMPTY) return [];

  const moves = [];
  const captures = [];
  const dirs = [];

  if (isRed(piece) || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (isBlack(piece) || isKing(piece)) dirs.push([1, -1], [1, 1]);

  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      if (board[nr][nc] === EMPTY && !mustCapture) {
        moves.push({ from: [row, col], to: [nr, nc], capture: null });
      }
      // Check capture
      const cr = row + dr * 2;
      const cc = col + dc * 2;
      if (cr >= 0 && cr < 8 && cc >= 0 && cc < 8 && board[cr][cc] === EMPTY) {
        const mid = board[nr][nc];
        if ((isRed(piece) && isBlack(mid)) || (isBlack(piece) && isRed(mid))) {
          captures.push({ from: [row, col], to: [cr, cc], capture: [nr, nc] });
        }
      }
    }
  }
  return captures.length > 0 ? captures : (mustCapture ? [] : moves);
}

function getAllValidMoves(board, isRedTurn) {
  const allMoves = [];
  const allCaptures = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if ((isRedTurn && isRed(piece)) || (!isRedTurn && isBlack(piece))) {
        const caps = getValidMoves(board, r, c, true);
        const moves = getValidMoves(board, r, c, false);
        allCaptures.push(...caps);
        if (caps.length === 0) allMoves.push(...moves);
      }
    }
  }
  return allCaptures.length > 0 ? allCaptures : allMoves;
}

function applyMove(board, move) {
  const newBoard = board.map(r => [...r]);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = newBoard[fr][fc];

  newBoard[tr][tc] = piece;
  newBoard[fr][fc] = EMPTY;

  if (move.capture) {
    const [cr, cc] = move.capture;
    newBoard[cr][cc] = EMPTY;
  }

  // King promotion
  if (piece === RED && tr === 0) newBoard[tr][tc] = RED_KING;
  if (piece === BLACK && tr === 7) newBoard[tr][tc] = BLACK_KING;

  return newBoard;
}

function checkWin(board) {
  let redCount = 0, blackCount = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isRed(board[r][c])) redCount++;
      if (isBlack(board[r][c])) blackCount++;
    }
  }
  if (redCount === 0) return 'black';
  if (blackCount === 0) return 'red';
  return null;
}

// AI move - basic minimax depth 3
function evaluateBoard(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === RED) score -= 1;
      if (p === RED_KING) score -= 2;
      if (p === BLACK) score += 1;
      if (p === BLACK_KING) score += 2;
    }
  }
  return score;
}

function minimax(board, depth, isMax, alpha, beta) {
  const win = checkWin(board);
  if (win === 'black') return 100 + depth;
  if (win === 'red') return -100 - depth;
  if (depth === 0) return evaluateBoard(board);

  const moves = getAllValidMoves(board, !isMax);
  if (moves.length === 0) return isMax ? -100 : 100;

  if (isMax) {
    let best = -Infinity;
    for (const move of moves) {
      const nb = applyMove(board, move);
      best = Math.max(best, minimax(nb, depth - 1, false, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const nb = applyMove(board, move);
      best = Math.min(best, minimax(nb, depth - 1, true, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function getAIMove(board) {
  const moves = getAllValidMoves(board, false);
  if (moves.length === 0) return null;
  let best = -Infinity;
  let bestMove = moves[0];
  for (const move of moves) {
    const nb = applyMove(board, move);
    const score = minimax(nb, 3, false, -Infinity, Infinity);
    if (score > best) { best = score; bestMove = move; }
  }
  return bestMove;
}

function validateMove(gameState, move, playerSide) {
  const { board, isRedTurn } = gameState;
  const isPlayerRed = playerSide === 'red';
  if (isPlayerRed !== isRedTurn) return { valid: false, reason: 'Not your turn' };

  const allMoves = getAllValidMoves(board, isRedTurn);
  const valid = allMoves.find(m =>
    m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
    m.to[0] === move.to[0] && m.to[1] === move.to[1]
  );

  if (!valid) return { valid: false, reason: 'Invalid move' };

  const newBoard = applyMove(board, valid);
  const winner = checkWin(newBoard);

  // Check multi-capture
  let nextTurn = !isRedTurn;
  let chainCapture = null;
  if (valid.capture) {
    const [tr, tc] = valid.to;
    const followups = getValidMoves(newBoard, tr, tc, true);
    if (followups.length > 0) {
      nextTurn = isRedTurn; // same player continues
      chainCapture = [tr, tc];
    }
  }

  return {
    valid: true,
    newBoard,
    nextTurn,
    winner,
    move: valid,
    chainCapture
  };
}

module.exports = {
  createInitialBoard,
  getAllValidMoves,
  validateMove,
  getAIMove,
  applyMove,
  checkWin,
  RED, BLACK, RED_KING, BLACK_KING, EMPTY
};
