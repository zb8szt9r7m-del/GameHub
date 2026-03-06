// Durak card game logic - server-side

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function createGame() {
  const deck = shuffle(createDeck());
  const trumpCard = deck[deck.length - 1];
  const trump = trumpCard.suit;

  const hand1 = deck.splice(0, 6);
  const hand2 = deck.splice(0, 6);

  // Player with lowest trump goes first
  let attacker = 0;
  let lowestTrump1 = hand1.filter(c => c.suit === trump).sort((a,b) => a.value - b.value)[0];
  let lowestTrump2 = hand2.filter(c => c.suit === trump).sort((a,b) => a.value - b.value)[0];

  if (lowestTrump2 && (!lowestTrump1 || lowestTrump2.value < lowestTrump1.value)) {
    attacker = 1;
  }

  return {
    deck,
    trump,
    trumpCard,
    hands: [hand1, hand2],
    table: [], // [{attack: card, defense: card|null}]
    attacker, // 0 or 1
    defender: attacker === 0 ? 1 : 0,
    phase: 'attack', // attack | defense | done
    winner: null,
    loser: null,
    message: '',
    turnCount: 0
  };
}

function cardKey(card) {
  return `${card.rank}${card.suit}`;
}

function canAttack(state, card) {
  if (state.table.length === 0) return true;
  // Subsequent attack cards must match rank of existing table cards
  const tableRanks = new Set();
  for (const pair of state.table) {
    tableRanks.add(pair.attack.rank);
    if (pair.defense) tableRanks.add(pair.defense.rank);
  }
  return tableRanks.has(card.rank);
}

function canDefend(state, attackCard, defendCard) {
  const { trump } = state;
  if (defendCard.suit === attackCard.suit && defendCard.value > attackCard.value) return true;
  if (defendCard.suit === trump && attackCard.suit !== trump) return true;
  return false;
}

function attack(state, playerIdx, card) {
  if (state.phase !== 'attack') return { ok: false, reason: 'Not attack phase' };
  if (playerIdx !== state.attacker) return { ok: false, reason: 'Not your turn to attack' };
  if (!canAttack(state, card)) return { ok: false, reason: 'Card rank not on table' };
  if (state.table.length >= 6) return { ok: false, reason: 'Max 6 attack cards' };

  // Remove card from hand
  const hand = state.hands[playerIdx];
  const cardIdx = hand.findIndex(c => cardKey(c) === cardKey(card));
  if (cardIdx === -1) return { ok: false, reason: 'Card not in hand' };

  hand.splice(cardIdx, 1);
  state.table.push({ attack: card, defense: null });
  state.phase = 'defense';
  state.message = `Player ${playerIdx + 1} attacks with ${card.rank}${card.suit}`;
  return { ok: true };
}

function defend(state, playerIdx, attackCard, defendCard) {
  if (state.phase !== 'defense') return { ok: false, reason: 'Not defense phase' };
  if (playerIdx !== state.defender) return { ok: false, reason: 'Not your turn to defend' };

  const pair = state.table.find(p => cardKey(p.attack) === cardKey(attackCard) && !p.defense);
  if (!pair) return { ok: false, reason: 'Attack card not found' };
  if (!canDefend(state, attackCard, defendCard)) return { ok: false, reason: 'Cannot beat that card' };

  const hand = state.hands[playerIdx];
  const cardIdx = hand.findIndex(c => cardKey(c) === cardKey(defendCard));
  if (cardIdx === -1) return { ok: false, reason: 'Card not in hand' };

  hand.splice(cardIdx, 1);
  pair.defense = defendCard;

  // Check if all attacks defended
  const allDefended = state.table.every(p => p.defense !== null);
  if (allDefended) {
    state.phase = 'attack'; // attacker can add more or end
  }
  state.message = `Player ${playerIdx + 1} defends with ${defendCard.rank}${defendCard.suit}`;
  return { ok: true };
}

function take(state, playerIdx) {
  if (playerIdx !== state.defender) return { ok: false, reason: 'Only defender can take' };
  // Defender takes all table cards
  const allCards = state.table.flatMap(p => [p.attack, p.defense].filter(Boolean));
  state.hands[playerIdx].push(...allCards);
  state.table = [];
  // Attacker stays attacker next turn (defender lost)
  refillHands(state);
  state.phase = 'attack';
  state.message = `Player ${playerIdx + 1} takes the cards`;
  checkGameEnd(state);
  return { ok: true };
}

function endTurn(state, playerIdx) {
  if (playerIdx !== state.attacker) return { ok: false, reason: 'Only attacker can end turn' };
  if (state.table.some(p => !p.defense)) return { ok: false, reason: 'Not all attacks defended' };

  // Discard table
  state.table = [];
  // Swap roles
  const oldAttacker = state.attacker;
  state.attacker = state.defender;
  state.defender = oldAttacker;
  refillHands(state);
  state.phase = 'attack';
  state.turnCount++;
  state.message = 'Turn ended, cards discarded';
  checkGameEnd(state);
  return { ok: true };
}

function refillHands(state) {
  // Attacker refills first, then defender
  const order = [state.attacker, state.defender];
  for (const idx of order) {
    while (state.hands[idx].length < 6 && state.deck.length > 0) {
      state.hands[idx].push(state.deck.shift());
    }
  }
}

function checkGameEnd(state) {
  if (state.deck.length > 0) return;
  const e0 = state.hands[0].length === 0;
  const e1 = state.hands[1].length === 0;
  if (e0 && e1) { state.winner = 'draw'; state.phase = 'done'; }
  else if (e0) { state.winner = 'player1'; state.loser = 'player2'; state.phase = 'done'; }
  else if (e1) { state.winner = 'player2'; state.loser = 'player1'; state.phase = 'done'; }
}

// AI decision
function aiAction(state, aiIdx) {
  if (state.phase === 'done') return null;

  if (aiIdx === state.attacker && state.phase === 'attack') {
    const hand = state.hands[aiIdx];
    if (state.table.length > 0 && state.table.every(p => p.defense)) {
      // Maybe add more attack cards
      const tableRanks = new Set(state.table.flatMap(p => [p.attack.rank, p.defense?.rank]).filter(Boolean));
      const extra = hand.find(c => tableRanks.has(c.rank));
      if (extra && state.table.length < 6) {
        return { action: 'attack', card: extra };
      }
      return { action: 'endTurn' };
    }
    if (state.table.length === 0) {
      const nonTrump = hand.filter(c => c.suit !== state.trump).sort((a,b) => a.value - b.value);
      const card = nonTrump[0] || hand.sort((a,b) => a.value - b.value)[0];
      return { action: 'attack', card };
    }
  }

  if (aiIdx === state.defender && state.phase === 'defense') {
    const hand = state.hands[aiIdx];
    const undefended = state.table.find(p => !p.defense);
    if (!undefended) return null;

    const defenders = hand.filter(c => canDefend(state, undefended.attack, c))
      .sort((a,b) => a.value - b.value);
    if (defenders.length > 0) {
      return { action: 'defend', attackCard: undefended.attack, defendCard: defenders[0] };
    }
    return { action: 'take' };
  }

  return null;
}

function getPublicState(state, playerIdx) {
  return {
    trump: state.trump,
    trumpCard: state.trumpCard,
    myHand: state.hands[playerIdx],
    opponentHandCount: state.hands[1 - playerIdx].length,
    table: state.table,
    attacker: state.attacker,
    defender: state.defender,
    phase: state.phase,
    winner: state.winner,
    loser: state.loser,
    deckCount: state.deck.length,
    message: state.message,
    myIndex: playerIdx,
    isMyTurn: (state.phase === 'attack' && state.attacker === playerIdx) ||
               (state.phase === 'defense' && state.defender === playerIdx)
  };
}

module.exports = { createGame, attack, defend, take, endTurn, aiAction, getPublicState, cardKey };
