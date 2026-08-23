const N = 9;
const TYPES = {
  sword: { hp: 120, atk: 24 },
  shield: { hp: 160, atk: 20 },
  spear: { hp: 120, atk: 24 },
};
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const DECK_SIZE = Number(process.env.DECK_SIZE || 25);
const DECK_COUNTS = DECK_SIZE === 20
  ? { sword: 7, shield: 7, spear: 6 }
  : DECK_SIZE === 25
    ? { sword: 9, shield: 9, spear: 7 }
    : null;
if (!DECK_COUNTS) throw new Error("DECK_SIZE must be 20 or 25");
const DECK = [
  ...Array(DECK_COUNTS.sword).fill("sword"),
  ...Array(DECK_COUNTS.shield).fill("shield"),
  ...Array(DECK_COUNTS.spear).fill("spear"),
];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let seed = 1;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const inBounds = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

function multiplier(attacker, defender) {
  if (COUNTER[attacker.type] !== defender.type) return 1;
  return attacker.type === "spear" && defender.type === "shield" ? 1.5 : 1.25;
}

function newPlayer(id) {
  return { id, deck: shuffle(DECK), hand: [], cooldown: [], artillery: 2 };
}
function drawToFive(player) {
  while (player.hand.length < 5 && player.deck.length) player.hand.push(player.deck.pop());
}
function startTurn(player) {
  const remaining = [];
  for (const item of player.cooldown) {
    item.turns--;
    if (item.turns <= 0) player.deck.push(item.type);
    else remaining.push(item);
  }
  player.cooldown = remaining;
  player.deck = shuffle(player.deck);
  drawToFive(player);
}

function hasFive(board, pid) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c]?.pid !== pid) continue;
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let length = 0;
      for (; length < 5; length++) {
        const rr = r + dr * length, cc = c + dc * length;
        if (!inBounds(rr, cc) || board[rr][cc]?.pid !== pid) break;
      }
      if (length === 5) return true;
    }
  }
  return false;
}

function threatWindows(board, pid) {
  const threats = new Map();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const cells = [];
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!inBounds(rr, cc)) { cells.length = 0; break; }
        cells.push([rr, cc]);
      }
      if (!cells.length) continue;
      let own = 0, enemy = 0, empty = 0;
      for (const [rr, cc] of cells) {
        const unit = board[rr][cc];
        if (!unit) empty++;
        else if (unit.pid === pid) own++;
        else enemy++;
      }
      if (enemy === 0 && ((own === 4 && empty === 1) || (own === 5 && empty === 0))) {
        threats.set(cells.map(([rr, cc]) => `${rr},${cc}`).join("|"), own === 5 ? 5 : 4);
      }
    }
  }
  return threats;
}

function winningUnitIds(board, pid) {
  const ids = new Set();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const units = [];
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!inBounds(rr, cc) || board[rr][cc]?.pid !== pid) { units.length = 0; break; }
        units.push(board[rr][cc]);
      }
      for (const unit of units) ids.add(unit.id);
    }
  }
  return ids;
}

function attackTargets(board, r, c, unit) {
  const result = [];
  if (unit.type === "spear") {
    for (const [dr, dc] of DIRS) for (let distance = 1; distance <= 2; distance++) {
      const rr = r + dr * distance, cc = c + dc * distance;
      if (!inBounds(rr, cc)) break;
      if (board[rr][cc]) {
        if (board[rr][cc].pid !== unit.pid) result.push([rr, cc, distance]);
        break;
      }
    }
  } else {
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc) && board[rr][cc] && board[rr][cc].pid !== unit.pid) {
        result.push([rr, cc, 1]);
      }
    }
  }
  return result;
}

function recycle(players, unit) {
  for (let i = 0; i < unit.cards; i++) {
    players[unit.pid - 1].cooldown.push({ type: unit.type, turns: 3 });
  }
}

function resolveCombat(board, players, stats, round) {
  const packets = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const unit = board[r][c];
    if (!unit) continue;
    const targets = attackTargets(board, r, c, unit);
    if (!targets.length) continue;
    const total = unit.atk * (unit.type === "sword" && targets.length === 1 ? 1.5 : 1);
    for (const [tr, tc, distance] of targets) {
      const target = board[tr][tc];
      const damage = total / targets.length
        * (unit.type === "spear" && distance === 2 ? 0.5 : 1)
        * multiplier(unit, target);
      packets.push({ attacker: unit, tr, tc, damage });
    }
  }

  const contributions = [];
  for (const packet of packets) {
    const target = board[packet.tr][packet.tc];
    if (!target) continue;
    if (target.type === "shield") {
      contributions.push({ attacker: packet.attacker, recipient: target, amount: packet.damage * 0.75 });
      continue;
    }
    const guards = [];
    for (const [dr, dc] of DIRS) {
      const rr = packet.tr + dr, cc = packet.tc + dc;
      if (inBounds(rr, cc) && board[rr][cc]?.pid === target.pid && board[rr][cc].type === "shield") {
        guards.push(board[rr][cc]);
      }
    }
    if (guards.length) {
      contributions.push({ attacker: packet.attacker, recipient: target, amount: packet.damage * 0.5 });
      for (const guard of guards) {
        contributions.push({ attacker: packet.attacker, recipient: guard, amount: packet.damage * 0.5 / guards.length * 0.75 });
      }
    } else {
      contributions.push({ attacker: packet.attacker, recipient: target, amount: packet.damage });
    }
  }

  const byRecipient = new Map();
  for (const contribution of contributions) {
    if (!byRecipient.has(contribution.recipient.id)) byRecipient.set(contribution.recipient.id, []);
    byRecipient.get(contribution.recipient.id).push(contribution);
  }
  for (const recipientContributions of byRecipient.values()) {
    const unit = recipientContributions[0].recipient;
    const total = recipientContributions.reduce((sum, item) => sum + item.amount, 0);
    const roundedDamage = Math.round(total);
    const effectiveDamage = Math.min(Math.max(0, unit.hp), roundedDamage);
    unit.damageTaken += effectiveDamage;
    if (total > 0) for (const contribution of recipientContributions) {
      contribution.attacker.damageDealt += effectiveDamage * contribution.amount / total;
    }
    unit.hp -= roundedDamage;
  }
  removeDead(board, players, stats, "combat", round);
}

function recordRank2(unit, stats, round) {
  if (unit.rank !== 2 || unit.rank2Recorded) return;
  unit.rank2Recorded = true;
  const detail = stats.rank2Detail[unit.type];
  detail.completed++;
  detail.survivalRounds += round - unit.placedRound + 1;
  detail.damageTaken += unit.damageTaken;
  detail.damageDealt += unit.damageDealt;
}

function removeDead(board, players, stats, cause = "combat", round = 0) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const unit = board[r][c];
    if (unit && unit.hp <= 0) {
      recordRank2(unit, stats, round);
      recycle(players, unit);
      board[r][c] = null;
      stats.deaths++;
      if (cause === "artillery") stats.artilleryKills++;
    }
  }
}

function finalizeRank2Stats(board, stats, round, p1HasFive, p2HasFive) {
  const finalFiveIds = new Set([
    ...(p1HasFive ? winningUnitIds(board, 1) : []),
    ...(p2HasFive ? winningUnitIds(board, 2) : []),
  ]);
  for (const row of board) for (const unit of row) {
    if (!unit || unit.rank !== 2) continue;
    if (finalFiveIds.has(unit.id)) stats.rank2Detail[unit.type].finalFiveParticipants++;
    recordRank2(unit, stats, round);
  }
}

function lineScore(board, r, c, pid, defenseWeight) {
  let score = -(Math.abs(r - 4) + Math.abs(c - 4)) * 0.05;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    for (let offset = -4; offset <= 0; offset++) {
      let own = 0, enemy = 0, valid = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * (offset + k), cc = c + dc * (offset + k);
        if (!inBounds(rr, cc)) { valid = false; break; }
        const unit = board[rr][cc];
        if (unit?.pid === pid) own++;
        else if (unit) enemy++;
      }
      if (!valid || (own && enemy)) continue;
      if (!enemy) score += own * own * 1.15 + (own === 4 ? 500 : 0);
      if (!own) score += defenseWeight * (enemy * enemy + (enemy === 4 ? 520 : 0));
    }
  }
  return score;
}

function chooseCell(board, pid, style) {
  const defenseWeight = style === "rush" ? 0.55 : style === "block" ? 1.35 : 0.85;
  let bestScore = -Infinity, best = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c]) continue;
    let score = lineScore(board, r, c, pid, defenseWeight);
    for (const [dr, dc] of DIRS) {
      const unit = inBounds(r + dr, c + dc) && board[r + dr][c + dc];
      if (unit) score += unit.pid === pid ? 0.25 : 0.4;
    }
    if (score > bestScore + 1e-6) { bestScore = score; best = [[r, c]]; }
    else if (Math.abs(score - bestScore) < 1e-6) best.push([r, c]);
  }
  return best.length ? best[Math.floor(random() * best.length)] : null;
}

function chooseArtillery(board, pid, style) {
  let best = null, bestScore = -Infinity;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let enemies = 0, allies = 0, kills = 0, score = 0;
    for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
      const unit = inBounds(rr, cc) && board[rr][cc];
      if (!unit) continue;
      const damage = rr === r && cc === c ? 30 : 12;
      if (unit.pid === pid) { allies++; score -= damage * 1.4; }
      else { enemies++; score += damage; if (unit.hp <= damage) kills++; }
    }
    score += kills * 60;
    if (score > bestScore) { bestScore = score; best = { r, c, enemies, allies, kills }; }
  }
  if (!best) return null;
  if (style === "artillery" && ((best.enemies >= 3 && best.allies <= 1) || best.kills >= 1)) return best;
  if (style === "balanced" && best.kills >= 2) return best;
  return null;
}

function chooseType(board, player, cell, style) {
  const count = { sword: 0, shield: 0, spear: 0 };
  player.hand.forEach(type => count[type]++);
  if (["sword", "shield", "spear"].includes(style) && count[style]) return style;
  if (style === "turtle" && count.shield) return "shield";
  const [r, c] = cell;
  let bestScore = -Infinity, best = [];
  for (const type of Object.keys(count).filter(type => count[type])) {
    let score = count[type] * 0.03;
    if (type === "shield") for (const [dr, dc] of DIRS) {
      const ally = inBounds(r + dr, c + dc) && board[r + dr][c + dc];
      if (ally?.pid === player.id && ally.type !== "shield") score += 2;
    }
    for (const [dr, dc] of DIRS) for (let distance = 1; distance <= 2; distance++) {
      const unit = inBounds(r + dr * distance, c + dc * distance)
        && board[r + dr * distance][c + dc * distance];
      if (!unit) continue;
      if (unit.pid !== player.id) {
        if (COUNTER[type] === unit.type) score += 2;
        if (type === "spear" && distance === 2) score += 0.5;
      } else if (type === "spear") score -= 0.3;
      break;
    }
    if (score > bestScore) { bestScore = score; best = [type]; }
    else if (score === bestScore) best.push(type);
  }
  return best[Math.floor(random() * best.length)];
}

function takeAction(board, players, pid, style, stats, round) {
  const player = players[pid - 1];
  if (!player.hand.length || !board.some(row => row.some(unit => !unit))) return false;
  const target = player.artillery && chooseArtillery(board, pid, style);
  if (target) {
    const enemyPid = pid === 1 ? 2 : 1;
    const threatsBefore = threatWindows(board, enemyPid);
    const killsBefore = stats.artilleryKills;
    let enemyHits = 0, friendlyHits = 0;
    player.artillery--;
    stats.artillery[pid - 1]++;
    for (let r = target.r - 1; r <= target.r + 1; r++) for (let c = target.c - 1; c <= target.c + 1; c++) {
      const unit = inBounds(r, c) && board[r][c];
      if (unit) {
        if (unit.pid === pid) friendlyHits++; else enemyHits++;
        const damage = r === target.r && c === target.c ? 30 : 12;
        unit.damageTaken += Math.min(Math.max(0, unit.hp), damage);
        unit.hp -= damage;
      }
    }
    removeDead(board, players, stats, "artillery", round);
    const threatsAfter = threatWindows(board, enemyPid);
    const prevented = [...threatsBefore.entries()].filter(([key]) => !threatsAfter.has(key)).map(([, kind]) => kind);
    const kills = stats.artilleryKills - killsBefore;
    stats.artilleryEvents.push({
      pid, round, enemyHits, friendlyHits, kills, createdSpaces: kills,
      preventedFour: prevented.filter(kind => kind === 4).length,
      preventedFive: prevented.filter(kind => kind === 5).length,
      hitTwoOrMoreEnemies: enemyHits >= 2,
      hitFriendly: friendlyHits > 0,
    });
  }
  const cell = chooseCell(board, pid, style);
  if (!cell) return false;
  const type = chooseType(board, player, cell, style);
  const count = player.hand.filter(item => item === type).length;
  let rank = 1;
  if ((style === "turtle" || style === "ranker") && count >= 3) rank = count >= 5 ? 3 : 2;
  else if (style === "balanced" && count >= 3 && random() < 0.25) {
    rank = count >= 5 && random() < 0.3 ? 3 : 2;
  }
  const cost = rank === 1 ? 1 : rank === 2 ? 3 : 5;
  for (let i = player.hand.length - 1, left = cost; i >= 0 && left; i--) {
    if (player.hand[i] === type) { player.hand.splice(i, 1); left--; }
  }
  const hpMultiplier = rank === 1 ? 1 : rank === 2 ? 3 : 5;
  const attackMultiplier = rank === 1 ? 1 : rank === 2 ? 2 : 3;
  board[cell[0]][cell[1]] = {
    id: stats.nextUnitId++, pid, type, rank, cards: cost, placedRound: round,
    hp: TYPES[type].hp * hpMultiplier,
    atk: TYPES[type].atk * attackMultiplier,
    damageTaken: 0,
    damageDealt: 0,
  };
  stats.ranks[rank]++;
  if (rank === 2) {
    stats.rank2ByType[type]++;
    stats.rank2Detail[type].deployments++;
  }
  stats.types[type]++;
  return true;
}

function play(style1, style2, gameSeed) {
  seed = gameSeed;
  const board = Array.from({ length: N }, () => Array(N).fill(null));
  const players = [newPlayer(1), newPlayer(2)];
  const stats = {
    deaths: 0,
    ranks: { 1: 0, 2: 0, 3: 0 },
    rank2ByType: { sword: 0, shield: 0, spear: 0 },
    rank2Detail: Object.fromEntries(Object.keys(TYPES).map(type => [type, {
      deployments: 0, completed: 0, survivalRounds: 0, damageTaken: 0, damageDealt: 0, finalFiveParticipants: 0,
    }])),
    types: { sword: 0, shield: 0, spear: 0 },
    artillery: [0, 0],
    artilleryKills: 0,
    artilleryEvents: [],
    deckZeroPlayers: [false, false],
    boardUnitRoundSum: 0,
    boardUnitSamples: 0,
    nextUnitId: 1,
  };
  const finish = (winner, round, p1Five, p2Five) => {
    finalizeRank2Stats(board, stats, round, p1Five, p2Five);
    return {
      winner,
      round,
      boardUnits: board.flat().filter(Boolean).length,
      avgBoardUnits: stats.boardUnitSamples ? stats.boardUnitRoundSum / stats.boardUnitSamples : 0,
      fiveCompleted: Boolean(p1Five || p2Five),
      ...stats,
    };
  };
  drawToFive(players[0]); drawToFive(players[1]);
  for (let round = 1; round <= 100; round++) {
    const first = round % 2 ? 1 : 2;
    let actions = 0;
    for (const pid of [first, 3 - first]) {
      startTurn(players[pid - 1]);
      actions += takeAction(board, players, pid, pid === 1 ? style1 : style2, stats, round);
      if (players[pid - 1].deck.length === 0) stats.deckZeroPlayers[pid - 1] = true;
    }
    resolveCombat(board, players, stats, round);
    stats.boardUnitRoundSum += board.flat().filter(Boolean).length;
    stats.boardUnitSamples++;
    const p1 = hasFive(board, 1), p2 = hasFive(board, 2);
    if (p1 || p2) {
      return finish(p1 && p2 ? 0 : p1 ? 1 : 2, round, p1, p2);
    }
    if (!actions) {
      return finish(0, round, false, false);
    }
  }
  return finish(0, 100, false, false);
}

const styles = (process.argv[3] || "rush,block,balanced,turtle,artillery").split(",");
const games = Number(process.argv[2] || 120);
function textSeed(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}
function matchupSeed(style1, style2, game) {
  return (100000 + textSeed(style1) + Math.imul(textSeed(style2), 31) + game) >>> 0;
}
const matrix = {};
const comparisonTotals = {
  games: 0, rounds: 0, boardUnits: 0, avgBoardUnits: 0, deployments: 0, rank2: 0, rank3: 0,
  deckZeroGames: 0, deckZeroPlayers: 0, fiveCompleted: 0,
};
for (const style1 of styles) {
  matrix[style1] = {};
  for (const style2 of styles) {
    const wins = [0, 0, 0];
    const parityWins = { oddP1: 0, oddP2: 0, evenP1: 0, evenP2: 0 };
    let rounds = 0, deaths = 0, rank2 = 0, rank3 = 0, boardUnits = 0, deckZeroGames = 0, fiveCompleted = 0;
    const artillery = [0, 0];
    const artilleryGames = [0, 0];
    let artilleryKills = 0;
    const artilleryEventTotals = {
      shots: 0, preventedFour: 0, preventedFive: 0, directKillShots: 0,
      createdSpaceShots: 0, hitTwoEnemyShots: 0, friendlyHitShots: 0,
    };
    const rank2ByType = { sword: 0, shield: 0, spear: 0 };
    const rank2Detail = Object.fromEntries(Object.keys(TYPES).map(type => [type, {
      deployments: 0, completed: 0, survivalRounds: 0, damageTaken: 0, damageDealt: 0, finalFiveParticipants: 0,
    }]));
    const types = { sword: 0, shield: 0, spear: 0 };
    for (let game = 0; game < games; game++) {
      const result = play(style1, style2, matchupSeed(style1, style2, game));
      wins[result.winner]++;
      if (result.winner) {
        const parity = result.round % 2 ? "odd" : "even";
        parityWins[`${parity}P${result.winner}`]++;
      }
      rounds += result.round;
      deaths += result.deaths;
      rank2 += result.ranks[2]; rank3 += result.ranks[3];
      boardUnits += result.boardUnits;
      if (result.deckZeroPlayers.some(Boolean)) deckZeroGames++;
      if (result.fiveCompleted) fiveCompleted++;
      comparisonTotals.games++;
      comparisonTotals.rounds += result.round;
      comparisonTotals.boardUnits += result.boardUnits;
      comparisonTotals.avgBoardUnits += result.avgBoardUnits;
      comparisonTotals.deployments += result.ranks[1] + result.ranks[2] + result.ranks[3];
      comparisonTotals.rank2 += result.ranks[2];
      comparisonTotals.rank3 += result.ranks[3];
      comparisonTotals.deckZeroGames += Number(result.deckZeroPlayers.some(Boolean));
      comparisonTotals.deckZeroPlayers += result.deckZeroPlayers.filter(Boolean).length;
      comparisonTotals.fiveCompleted += Number(result.fiveCompleted);
      artillery[0] += result.artillery[0]; artillery[1] += result.artillery[1];
      if (result.artillery[0] > 0) artilleryGames[0]++;
      if (result.artillery[1] > 0) artilleryGames[1]++;
      artilleryKills += result.artilleryKills;
      for (const type of Object.keys(rank2ByType)) rank2ByType[type] += result.rank2ByType[type];
      for (const type of Object.keys(rank2Detail)) for (const field of Object.keys(rank2Detail[type])) {
        rank2Detail[type][field] += result.rank2Detail[type][field];
      }
      for (const event of result.artilleryEvents) {
        artilleryEventTotals.shots++;
        artilleryEventTotals.preventedFour += event.preventedFour;
        artilleryEventTotals.preventedFive += event.preventedFive;
        if (event.kills > 0) artilleryEventTotals.directKillShots++;
        if (event.createdSpaces > 0) artilleryEventTotals.createdSpaceShots++;
        if (event.hitTwoOrMoreEnemies) artilleryEventTotals.hitTwoEnemyShots++;
        if (event.hitFriendly) artilleryEventTotals.friendlyHitShots++;
      }
      for (const type of Object.keys(types)) types[type] += result.types[type];
    }
    matrix[style1][style2] = {
      p1: +(wins[1] / games).toFixed(3),
      p2: +(wins[2] / games).toFixed(3),
      draw: +(wins[0] / games).toFixed(3),
      parityWins,
      rounds: +(rounds / games).toFixed(1),
      deaths: +(deaths / games).toFixed(1),
      rank2: +(rank2 / games).toFixed(1),
      rank3: +(rank3 / games).toFixed(2),
      finalBoardUnits: +(boardUnits / games).toFixed(2),
      deckZeroGameRate: +(deckZeroGames / games).toFixed(3),
      fiveCompletionRate: +(fiveCompleted / games).toFixed(3),
      rank2ByType: Object.fromEntries(Object.entries(rank2ByType).map(([type, value]) => [type, +(value / games).toFixed(2)])),
      artillery: artillery.map(value => +(value / games).toFixed(2)),
      artilleryGameRate: artilleryGames.map(value => +(value / games).toFixed(3)),
      artilleryTurnRate: artillery.map(value => +(value / rounds).toFixed(3)),
      artilleryKills: +(artilleryKills / games).toFixed(2),
      artilleryEventStats: {
        shots: artilleryEventTotals.shots,
        preventedFourPerGame: +(artilleryEventTotals.preventedFour / games).toFixed(3),
        preventedFivePerGame: +(artilleryEventTotals.preventedFive / games).toFixed(3),
        directKillShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.directKillShots / artilleryEventTotals.shots).toFixed(3) : 0,
        createdSpaceShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.createdSpaceShots / artilleryEventTotals.shots).toFixed(3) : 0,
        hitTwoEnemyShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.hitTwoEnemyShots / artilleryEventTotals.shots).toFixed(3) : 0,
        friendlyHitShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.friendlyHitShots / artilleryEventTotals.shots).toFixed(3) : 0,
      },
      rank2Metrics: Object.fromEntries(Object.entries(rank2Detail).map(([type, detail]) => [type, {
        deployments: detail.deployments,
        trackedUnits: detail.completed,
        deploymentsPerGame: +(detail.deployments / games).toFixed(3),
        avgSurvivalRounds: detail.completed ? +(detail.survivalRounds / detail.completed).toFixed(2) : 0,
        avgDamageTaken: detail.completed ? +(detail.damageTaken / detail.completed).toFixed(2) : 0,
        avgDamageDealt: detail.completed ? +(detail.damageDealt / detail.completed).toFixed(2) : 0,
        finalFiveParticipationRate: detail.deployments ? +(detail.finalFiveParticipants / detail.deployments).toFixed(3) : 0,
        finalFiveParticipants: detail.finalFiveParticipants,
      }])),
      types: Object.fromEntries(Object.entries(types).map(([type, value]) => [type, +(value / games).toFixed(1)])),
    };
  }
}

function artilleryCounterfactual(shooterPid) {
  let changedWinner = 0, helpedShooter = 0, hurtShooter = 0, usedGames = 0;
  let shots = 0, artilleryKills = 0, armedRounds = 0, baselineRounds = 0, armedDeaths = 0, baselineDeaths = 0;
  for (let game = 0; game < games; game++) {
    const gameSeed = 900000 + shooterPid * 100000 + game;
    const armed = shooterPid === 1
      ? play("artillery", "standard", gameSeed)
      : play("standard", "artillery", gameSeed);
    const baseline = play("standard", "standard", gameSeed);
    const shooterShots = armed.artillery[shooterPid - 1];
    shots += shooterShots;
    if (shooterShots > 0) usedGames++;
    artilleryKills += armed.artilleryKills;
    armedRounds += armed.round; baselineRounds += baseline.round;
    armedDeaths += armed.deaths; baselineDeaths += baseline.deaths;
    if (armed.winner !== baseline.winner) changedWinner++;
    if (armed.winner === shooterPid && baseline.winner !== shooterPid) helpedShooter++;
    if (baseline.winner === shooterPid && armed.winner !== shooterPid) hurtShooter++;
  }
  return {
    shooterPid,
    changedWinnerRate: +(changedWinner / games).toFixed(3),
    helpedShooterRate: +(helpedShooter / games).toFixed(3),
    hurtShooterRate: +(hurtShooter / games).toFixed(3),
    usedGameRate: +(usedGames / games).toFixed(3),
    shotsPerGame: +(shots / games).toFixed(2),
    artilleryKillsPerGame: +(artilleryKills / games).toFixed(2),
    armedAvgRounds: +(armedRounds / games).toFixed(1),
    baselineAvgRounds: +(baselineRounds / games).toFixed(1),
    armedAvgDeaths: +(armedDeaths / games).toFixed(1),
    baselineAvgDeaths: +(baselineDeaths / games).toFixed(1),
  };
}

const causalArtillery = styles.includes("artillery") && styles.includes("standard")
  ? [artilleryCounterfactual(1), artilleryCounterfactual(2)]
  : null;
const comparisonSummary = {
  deckSize: DECK_SIZE,
  deckCounts: DECK_COUNTS,
  games: comparisonTotals.games,
  avgBoardUnits: +(comparisonTotals.avgBoardUnits / comparisonTotals.games).toFixed(3),
  avgFinalBoardUnits: +(comparisonTotals.boardUnits / comparisonTotals.games).toFixed(3),
  avgRounds: +(comparisonTotals.rounds / comparisonTotals.games).toFixed(3),
  rank2DeploymentRate: +(comparisonTotals.rank2 / comparisonTotals.deployments).toFixed(4),
  rank3DeploymentRate: +(comparisonTotals.rank3 / comparisonTotals.deployments).toFixed(4),
  avgRank2Deployments: +(comparisonTotals.rank2 / comparisonTotals.games).toFixed(3),
  avgRank3Deployments: +(comparisonTotals.rank3 / comparisonTotals.games).toFixed(3),
  deckZeroGameRate: +(comparisonTotals.deckZeroGames / comparisonTotals.games).toFixed(4),
  deckZeroPlayerRate: +(comparisonTotals.deckZeroPlayers / (comparisonTotals.games * 2)).toFixed(4),
  fiveCompletionRate: +(comparisonTotals.fiveCompleted / comparisonTotals.games).toFixed(4),
};
console.log(JSON.stringify({ gamesPerMatchup: games, seedPolicy: "fixed-fnv1a-v1", comparisonSummary, matrix, causalArtillery }, null, 2));
