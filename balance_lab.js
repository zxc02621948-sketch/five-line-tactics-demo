const N = 9;
const TYPES = {
  sword: { hp: 120, atk: 24 },
  shield: { hp: 160, atk: 20 },
  spear: { hp: 120, atk: 24 },
};
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const DECK_SIZE = Number(process.env.DECK_SIZE || 25);
const TURN_ORDER_MODE = process.env.TURN_ORDER_MODE === "fixed" ? "fixed" : "alternating";
const DISABLE_ARTILLERY = process.env.DISABLE_ARTILLERY === "1";
const DISABLE_RANKS = process.env.DISABLE_RANKS === "1";
const FORCED_OPENING = /^\d,\d$/.test(process.env.FORCED_OPENING || "")
  ? process.env.FORCED_OPENING.split(",").map(Number) : null;
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
const CENTER_CELL = "4,4";
const CENTER_3X3 = new Set(Array.from({ length: 9 }, (_, index) => `${3 + Math.floor(index / 3)},${3 + index % 3}`));
// Outside the center 3x3, these four cells each belong to 14 distinct five-cell windows.
const KEY_CROSS_CELLS = new Set(["2,4", "4,2", "4,6", "6,4"]);

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

function maxContiguous(board, pid) {
  let best = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c]?.pid !== pid) continue;
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let length = 0;
      for (let rr = r, cc = c; inBounds(rr, cc) && board[rr][cc]?.pid === pid; rr += dr, cc += dc) length++;
      best = Math.max(best, length);
    }
  }
  return best;
}

function updateFirstFormation(stats, board, pid, round) {
  const formation = stats.firstFormation[pid - 1];
  const longest = maxContiguous(board, pid);
  for (const length of [2, 3, 4]) if (formation[length] === null && longest >= length) formation[length] = round;
  if (formation.fiveThreat === null && [...threatWindows(board, pid).values()].some(kind => kind === 4)) {
    formation.fiveThreat = round;
  }
}

function fiveWindowStates(board, pid) {
  const windows = new Map();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const cells = [];
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!inBounds(rr, cc)) { cells.length = 0; break; }
        cells.push([rr, cc]);
      }
      if (!cells.length) continue;
      let own = 0, enemy = 0, longestOwn = 0, run = 0;
      for (const [rr, cc] of cells) {
        const unit = board[rr][cc];
        if (unit?.pid === pid) { own++; run++; longestOwn = Math.max(longestOwn, run); }
        else { run = 0; if (unit) enemy++; }
      }
      const key = cells.map(([rr, cc]) => `${rr},${cc}`).join("|");
      windows.set(key, { key, cells, own, enemy, longestOwn });
    }
  }
  return windows;
}

function windowContains(window, deployment) {
  return Boolean(deployment && window.cells.some(([r, c]) => r === deployment.r && c === deployment.c));
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

// counter 風格的唯一情報來源。只讀棋盤上敵方單位的兵種、星級與位置，
// 不接觸 players[]（手牌、牌庫、冷卻皆為私有資訊）。
function enemyBoardProfile(board, pid) {
  const weightByType = { sword: 0, shield: 0, spear: 0 };
  const rank2 = { sword: [], shield: [], spear: [] };
  let total = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const unit = board[r][c];
    if (!unit || unit.pid === pid) continue;
    // 星級權重＝場上可見的牌面成本，讓一隻★★等同三隻一星的存在感。
    const weight = unit.rank === 1 ? 1 : unit.rank === 2 ? 3 : 5;
    weightByType[unit.type] += weight;
    total += weight;
    if (unit.rank >= 2) rank2[unit.type].push([r, c]);
  }
  return { weightByType, rank2, total };
}

// 升星率實驗用的五種 AI。除了「有資格時升星的機率」以外，選格／防守／五連／
// 選兵種／炮擊／所有權重都與 balanced 完全相同（見 chooseCell、chooseType、chooseArtillery）。
const RANK_STYLES = { up0: 0, up25: 0.25, up50: 0.5, up75: 0.75, up100: 1 };

// counter 的兩個權重旋鈕（掃描用；預設值是掃出來最平衡的一組）。
// 二星倍率旋鈕：純測試用，預設值就是現行規則（HP x3 / ATK x2），不改變任何預設行為。
const RANK2_HP_MULTIPLIER = Number(process.env.RANK2_HP ?? 3);
const RANK2_ATK_MULTIPLIER = Number(process.env.RANK2_ATK ?? 2);
const COUNTER_SHARE_WEIGHT = Number(process.env.COUNTER_SHARE_WEIGHT ?? 1.2);
const COUNTER_RANK2_WEIGHT = Number(process.env.COUNTER_RANK2_WEIGHT ?? 2.4);

function newRank2Economy() {
  return {
    count: 0,
    firstRound: null,
    secondRound: null,
    remainingAfterCraft: 0,
    craftSamples: 0,
    craftedTypes: {},
    laterDeploys: 0,
    exhaustedTurns: 0,
    deaths: 0,
    survivalRounds: 0,
    deathRoundSum: 0,
    peakDirsSum: 0,
    lifetimeDirsSum: 0,
    killedByCounterMajority: 0,
    counterDamageShareSum: 0,
    counterShareSamples: 0,
  };
}

// 追蹤三連／四連的生成與消滅，並判斷四連是被「堵格」還是被「打死棋子」破壞。
// phase: "action" = 剛完成炮擊＋部署（消失只可能是堵格或炮擊擊殺）
//        "combat" = 剛完成同步戰鬥（消失只可能是戰鬥擊殺）
function trackFormations(board, stats, phase, round) {
  for (const pid of [1, 2]) {
    const windows = fiveWindowStates(board, pid);
    resolveThreeLifecycles(board, pid, windows, stats, round, phase);
    const nowThree = new Set(), nowFour = new Map();
    for (const window of windows.values()) {
      if (window.enemy || window.longestOwn !== window.own) continue;
      if (window.own === 3) nowThree.add(window.key);
      if (window.own === 4) {
        nowFour.set(window.key, { cells: window.cells, empty: window.cells.find(([r, c]) => !board[r][c]) });
      }
    }
    for (const key of nowThree) if (!stats.activeThree[pid - 1].has(key)) stats.threeRuns++;
    for (const key of nowFour.keys()) if (!stats.activeFour[pid - 1].has(key)) stats.fourRuns++;
    for (const [key, info] of stats.activeFour[pid - 1]) {
      if (nowFour.has(key) || !info.empty) continue;
      const occupant = board[info.empty[0]][info.empty[1]];
      const lostOwnUnit = info.cells.some(([r, c]) => board[r][c]?.pid !== pid);
      if (occupant?.pid === pid) stats.fourBreaks.completed++;
      else if (occupant) stats.fourBreaks.blocked++;
      else if (lostOwnUnit) stats.fourBreaks[phase === "combat" ? "killedInCombat" : "killedByArtillery"]++;
      else stats.fourBreaks.other++;
    }
    stats.activeThree[pid - 1] = nowThree;
    stats.activeFour[pid - 1] = nowFour;
  }
}

// 三連的 lifecycle 追蹤。身分＝「方向＋這三顆自己的棋格」，所以同一組棋格在多個
// 五格窗裡出現時只會建立一筆紀錄，不會每回合重複計數。
function threeFormationsFor(board, pid, windows) {
  const found = new Map();
  for (const window of windows.values()) {
    if (window.enemy || window.own !== 3) continue;
    const [ar, ac] = window.cells[0], [br, bc] = window.cells[1];
    const dr = br - ar, dc = bc - ac;
    const owned = [];
    window.cells.forEach(([r, c], index) => { if (board[r][c]?.pid === pid) owned.push({ r, c, index }); });
    const key = `${dr},${dc}|` + owned.map(item => `${item.r},${item.c}`).join("|");
    if (found.has(key)) continue;
    const contiguous = owned[2].index - owned[0].index === 2;
    let bothEndsOpen = null;
    if (contiguous) {
      const head = [owned[0].r - dr, owned[0].c - dc];
      const tail = [owned[2].r + dr, owned[2].c + dc];
      const open = ([r, c]) => inBounds(r, c) && !board[r][c];
      bothEndsOpen = open(head) && open(tail);
    }
    found.set(key, {
      cells: owned.map(item => [item.r, item.c]),
      contiguous,
      bothEndsOpen,
      hasRank2: owned.some(item => board[item.r][item.c].rank >= 2),
    });
  }
  return found;
}

// 一組三格是否為某個四連／五連的子集合。是的話它不是「對手看得到並能回應的純三連」，
// 而只是更大 formation 的一個切片。
function isSubsetOfBigger(cells, windows) {
  for (const window of windows.values()) {
    if (window.enemy || window.own < 4) continue;
    if (cells.every(([r, c]) => window.cells.some(([wr, wc]) => wr === r && wc === c))) return true;
  }
  return false;
}

// 三個平行定義同時統計，用來拆解 median=0 的成因：
//   raw    ＝ 原始定義（任何階段建檔、不過濾子集合）
//   pure   ＝ 只過濾掉四／五連子集合，建檔時機不變（單獨看「子集合」的影響）
//   strict ＝ 過濾子集合 ＋ 只在整輪戰鬥結算後建檔（本輪要求的定義）
const THREE_TRACKERS = [
  { name: "raw", pureOnly: false, createPhases: ["action", "combat"] },
  { name: "pure", pureOnly: true, createPhases: ["action", "combat"] },
  { name: "strict", pureOnly: true, createPhases: ["combat"] },
];

function resolveThreeLifecycles(board, pid, windows, stats, round, phase) {
  for (const tracker of THREE_TRACKERS) {
    resolveOneThreeTracker(board, pid, windows, stats, round, phase, tracker);
  }
}

function resolveOneThreeTracker(board, pid, windows, stats, round, phase, tracker) {
  const active = stats.activeThreeLife[tracker.name][pid - 1];
  const sink = stats.threeLife[tracker.name];
  // 先結算既有紀錄，再建立新紀錄，避免同一次呼叫內建檔又立刻結案。
  for (const [key, record] of [...active]) {
    const intact = record.cells.every(([r, c]) => board[r][c]?.pid === pid);
    let outcome = null;
    if (!intact) outcome = phase === "combat" ? "killedInCombat" : "killedByArtillery";
    else {
      let upgraded = false, survivableWindow = false;
      for (const window of windows.values()) {
        if (window.enemy) continue;
        if (!record.cells.every(([r, c]) => window.cells.some(([wr, wc]) => wr === r && wc === c))) continue;
        survivableWindow = true;
        if (window.own >= 4) upgraded = true;
      }
      if (upgraded) outcome = "upgradedToFour";
      else if (!survivableWindow) outcome = "blocked";
    }
    if (!outcome) continue;
    sink.push({
      outcome,
      elapsed: round - record.formedRound,
      hasRank2: record.hasRank2,
      contiguous: record.contiguous,
      bothEndsOpen: record.bothEndsOpen,
    });
    active.delete(key);
  }
  if (!tracker.createPhases.includes(phase)) return;
  const current = threeFormationsFor(board, pid, windows);
  for (const [key, info] of current) {
    if (active.has(key)) continue;
    if (tracker.pureOnly && isSubsetOfBigger(info.cells, windows)) continue;
    active.set(key, { ...info, formedRound: round });
  }
}

function counterTypeOf(type) {
  return Object.keys(COUNTER).find(key => COUNTER[key] === type);
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
      packets.push({ attacker: unit, ar: r, ac: c, tr, tc, damage });
    }
  }

  // 本輪每個單位被幾個「不同方向」的敵人打到。攻擊一律沿正交四方，故上限為 4。
  const dirsByTarget = new Map();
  for (const packet of packets) {
    const target = board[packet.tr][packet.tc];
    if (!target) continue;
    const key = `${Math.sign(packet.ar - packet.tr)},${Math.sign(packet.ac - packet.tc)}`;
    if (!dirsByTarget.has(target.id)) dirsByTarget.set(target.id, { unit: target, dirs: new Set() });
    dirsByTarget.get(target.id).dirs.add(key);
  }
  for (const { unit, dirs } of dirsByTarget.values()) {
    unit.peakAttackDirs = Math.max(unit.peakAttackDirs, dirs.size);
    for (const key of dirs) unit.lifetimeAttackDirs.add(key);
  }

  const contributions = [];
  for (const packet of packets) {
    const target = board[packet.tr][packet.tc];
    if (!target) continue;
    if (target.type === "shield") {
      // 盾的耐久只由高 HP 表現，不再額外減傷。
      contributions.push({ attacker: packet.attacker, recipient: target, amount: packet.damage });
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
        contributions.push({ attacker: packet.attacker, recipient: guard, amount: packet.damage * 0.5 / guards.length });
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
      const share = effectiveDamage * contribution.amount / total;
      contribution.attacker.damageDealt += share;
      unit.damageByType[contribution.attacker.type] += share;
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
      if (unit.rank === 2) {
        const economy = stats.rank2Economy[unit.pid - 1];
        economy.deaths++;
        economy.survivalRounds += round - unit.placedRound + 1;
        economy.deathRoundSum += round;
        economy.peakDirsSum += unit.peakAttackDirs;
        economy.lifetimeDirsSum += unit.lifetimeAttackDirs.size;
        const byType = unit.damageByType;
        const typedTotal = byType.sword + byType.shield + byType.spear;
        if (typedTotal > 0) {
          const share = byType[counterTypeOf(unit.type)] / typedTotal;
          economy.counterDamageShareSum += share;
          economy.counterShareSamples++;
          if (share >= 0.5) economy.killedByCounterMajority++;
        }
      }
      recycle(players, unit);
      board[r][c] = null;
      stats.deaths++;
      if (cause === "artillery") {
        stats.artilleryKills++;
        stats.artilleryDeathsByPid[unit.pid - 1]++;
      } else stats.combatDeathsByPid[unit.pid - 1]++;
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
  if ((style === "balanced" || style === "counter" || RANK_STYLES[style] !== undefined) && best.kills >= 2) return best;
  return null;
}

function chooseType(board, player, cell, style) {
  const count = { sword: 0, shield: 0, spear: 0 };
  player.hand.forEach(type => count[type]++);
  if (["sword", "shield", "spear"].includes(style) && count[style]) return style;
  if (style === "turtle" && count.shield) return "shield";
  const [r, c] = cell;
  // counter：依敵方場上兵種組成調整權重。落點已由 chooseCell 依五連／防守選定，
  // 這裡只影響「這一格放什麼兵種」，且僅能從手上真的有的兵種挑，故不會變成無腦單壓。
  const profile = style === "counter" ? enemyBoardProfile(board, player.id) : null;
  let bestScore = -Infinity, best = [];
  for (const type of Object.keys(count).filter(type => count[type])) {
    let score = count[type] * 0.03;
    if (profile && profile.total) {
      const prey = COUNTER[type];
      // 敵方被本兵種剋制的那一種佔比越高，權重越高。
      score += profile.weightByType[prey] / profile.total * COUNTER_SHARE_WEIGHT;
      // 敵方該兵種的★★：離這個落點越近才越值得針對，避免隔半個棋盤瞎壓兵種。
      for (const [er, ec] of profile.rank2[prey]) {
        const distance = Math.max(Math.abs(er - r), Math.abs(ec - c));
        score += COUNTER_RANK2_WEIGHT / (1 + distance);
      }
    }
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
  const economy = stats.rank2Economy[pid - 1];
  // 已經合成過★★的兵種，本回合在牌庫＋手牌是否已完全取不到（＝真正的兵種耗盡）。
  for (const craftedType of Object.keys(economy.craftedTypes)) {
    const available = player.deck.filter(item => item === craftedType).length
      + player.hand.filter(item => item === craftedType).length;
    if (available === 0) economy.exhaustedTurns++;
  }
  if (!player.hand.length || !board.some(row => row.some(unit => !unit))) return false;
  const target = !DISABLE_ARTILLERY && player.artillery && chooseArtillery(board, pid, style);
  if (target) {
    const enemyPid = pid === 1 ? 2 : 1;
    const threatsBefore = threatWindows(board, enemyPid);
    const killsBefore = stats.artilleryKills;
    let enemyHits = 0, friendlyHits = 0, hitFreshFirstUnit = false;
    player.artillery--;
    stats.artillery[pid - 1]++;
    const isRoundSecondPlayer = pid !== stats.roundFirstPlayer;
    if (isRoundSecondPlayer) stats.secondArtilleryShots++;
    for (let r = target.r - 1; r <= target.r + 1; r++) for (let c = target.c - 1; c <= target.c + 1; c++) {
      const unit = inBounds(r, c) && board[r][c];
      if (unit) {
        if (unit.pid === pid) friendlyHits++; else enemyHits++;
        if (isRoundSecondPlayer && unit.pid === stats.roundFirstPlayer && unit.placedRound === round) hitFreshFirstUnit = true;
        const damage = r === target.r && c === target.c ? 30 : 12;
        unit.damageTaken += Math.min(Math.max(0, unit.hp), damage);
        unit.hp -= damage;
      }
    }
    if (hitFreshFirstUnit) stats.secondArtilleryFreshFirstHits++;
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
  const enemyPid = pid === 1 ? 2 : 1;
  const threatsBeforeDeploy = threatWindows(board, enemyPid);
  let cell = chooseCell(board, pid, style);
  if (FORCED_OPENING && round === 1 && pid === stats.matchFirstPlayer && !stats.openingCell
    && inBounds(FORCED_OPENING[0], FORCED_OPENING[1]) && !board[FORCED_OPENING[0]][FORCED_OPENING[1]]) {
    cell = FORCED_OPENING;
  }
  if (!cell) return false;
  const type = chooseType(board, player, cell, style);
  const count = player.hand.filter(item => item === type).length;
  let rank = 1;
  if (!DISABLE_RANKS) {
    const upgradeChance = RANK_STYLES[style];
    if (upgradeChance !== undefined) {
      // 兩次 random() 一律先抽掉，讓五種升星率 AI 在同一個盤面上消耗完全相同的
      // 亂數流；否則種子會因升星機率而發散，矩陣就不是純粹的單變數比較。
      const upgradeRoll = random();
      const rank3Roll = random();
      if (count >= 3 && upgradeRoll < upgradeChance) rank = count >= 5 && rank3Roll < 0.3 ? 3 : 2;
    }
    else if ((style === "turtle" || style === "ranker") && count >= 3) rank = count >= 5 ? 3 : 2;
    else if ((style === "balanced" || style === "counter") && count >= 3 && random() < 0.25) {
      rank = count >= 5 && random() < 0.3 ? 3 : 2;
    }
  }
  const cost = rank === 1 ? 1 : rank === 2 ? 3 : 5;
  for (let i = player.hand.length - 1, left = cost; i >= 0 && left; i--) {
    if (player.hand[i] === type) { player.hand.splice(i, 1); left--; }
  }
  const hpMultiplier = rank === 1 ? 1 : rank === 2 ? RANK2_HP_MULTIPLIER : 5;
  const attackMultiplier = rank === 1 ? 1 : rank === 2 ? RANK2_ATK_MULTIPLIER : 3;
  board[cell[0]][cell[1]] = {
    id: stats.nextUnitId++, pid, type, rank, cards: cost, placedRound: round,
    hp: TYPES[type].hp * hpMultiplier,
    atk: TYPES[type].atk * attackMultiplier,
    damageTaken: 0,
    damageDealt: 0,
    damageByType: { sword: 0, shield: 0, spear: 0 },
    peakAttackDirs: 0,
    lifetimeAttackDirs: new Set(),
  };
  // 必須先結算「後續部署」再登記本次合成，否則★★自己會被算成自己的後續。
  if (economy.craftedTypes[type] !== undefined) economy.laterDeploys++;
  stats.lastDeployment = { pid, round, r: cell[0], c: cell[1], unitId: board[cell[0]][cell[1]].id };
  const role = pid === stats.matchFirstPlayer ? "first" : "second";
  const cellKey = `${cell[0]},${cell[1]}`;
  if (!stats.openingCell && role === "first") stats.openingCell = cellKey;
  if (!stats.regionRace.center3 && CENTER_3X3.has(cellKey)) stats.regionRace.center3 = role;
  if (!stats.regionRace.center && cellKey === CENTER_CELL) stats.regionRace.center = role;
  if (!stats.regionRace.keyCross && KEY_CROSS_CELLS.has(cellKey)) stats.regionRace.keyCross = role;
  const threatsAfterDeploy = threatWindows(board, enemyPid);
  stats.normalBlocks[pid - 1] += [...threatsBeforeDeploy.keys()].filter(key => !threatsAfterDeploy.has(key)).length;
  stats.ranks[rank]++;
  if (rank === 2) {
    stats.rank2ByType[type]++;
    stats.rank2Detail[type].deployments++;
    economy.count++;
    if (economy.firstRound === null) economy.firstRound = round;
    else if (economy.secondRound === null) economy.secondRound = round;
    // 合成當下該兵種還剩幾張「立即可用」的牌（冷卻中的不算，因為部署不了）。
    economy.remainingAfterCraft += player.deck.filter(item => item === type).length
      + player.hand.filter(item => item === type).length;
    economy.craftSamples++;
    if (economy.craftedTypes[type] === undefined) economy.craftedTypes[type] = round;
  }
  stats.types[type]++;
  stats.typesByPid[pid - 1][type]++;
  return true;
}

function play(style1, style2, gameSeed, fixedStartingPlayer = 1) {
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
    typesByPid: [{ sword: 0, shield: 0, spear: 0 }, { sword: 0, shield: 0, spear: 0 }],
    artillery: [0, 0],
    artilleryKills: 0,
    artilleryEvents: [],
    combatDeathsByPid: [0, 0],
    artilleryDeathsByPid: [0, 0],
    normalBlocks: [0, 0],
    firstFormation: [
      { 2: null, 3: null, 4: null, fiveThreat: null },
      { 2: null, 3: null, 4: null, fiveThreat: null },
    ],
    regionRace: { center3: null, center: null, keyCross: null },
    openingCell: null,
    firstWinFeatures: null,
    deckZeroPlayers: [false, false],
    boardUnitRoundSum: 0,
    boardUnitSamples: 0,
    matchFirstPlayer: TURN_ORDER_MODE === "fixed" ? fixedStartingPlayer : 1,
    roundFirstPlayer: 1,
    firstFiveOpportunities: 0,
    firstFiveBrokenBySecond: 0,
    secondFiveOpportunities: 0,
    secondFiveDirectWins: 0,
    secondArtilleryShots: 0,
    secondArtilleryFreshFirstHits: 0,
    crossRoundWins: 0,
    crossRoundThreeToFiveWins: 0,
    crossRoundFourToFiveWins: 0,
    lastDeployment: null,
    nextUnitId: 1,
    rank2Economy: [newRank2Economy(), newRank2Economy()],
    activeThree: [new Set(), new Set()],
    activeThreeLife: Object.fromEntries(THREE_TRACKERS.map(t => [t.name, [new Map(), new Map()]])),
    threeLife: Object.fromEntries(THREE_TRACKERS.map(t => [t.name, []])),
    activeFour: [new Map(), new Map()],
    threeRuns: 0,
    fourRuns: 0,
    fourBreaks: { completed: 0, blocked: 0, killedInCombat: 0, killedByArtillery: 0, other: 0 },
    boardUnitsAtRound: {},
    fiveBoardUnits: null,
  };
  const finish = (winner, round, p1Five, p2Five) => {
    if (winner === stats.matchFirstPlayer) {
      const first = stats.matchFirstPlayer, second = 3 - first;
      const finalIds = winningUnitIds(board, first);
      const finalUnits = [];
      let keyCellFinalFive = false;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const unit = board[r][c];
        if (!unit || !finalIds.has(unit.id)) continue;
        finalUnits.push(unit);
        const key = `${r},${c}`;
        if (key === CENTER_CELL || KEY_CROSS_CELLS.has(key)) keyCellFinalFive = true;
      }
      const combatKillAdvantage = stats.combatDeathsByPid[second - 1] > stats.combatDeathsByPid[first - 1];
      const artilleryImpact = stats.artilleryEvents.some(event => event.pid === first
        && (event.kills > 0 || event.preventedFour > 0 || event.preventedFive > 0));
      const highRankFinalFive = finalUnits.some(unit => unit.rank > 1);
      stats.firstWinFeatures = {
        pureFiveSpeed: !combatKillAdvantage && !artilleryImpact && !highRankFinalFive,
        combatKillAdvantage,
        artilleryImpact,
        highRankFinalFive,
        keyCellFinalFive,
      };
    }
    finalizeRank2Stats(board, stats, round, p1Five, p2Five);
    for (const tracker of THREE_TRACKERS) for (const pid of [1, 2]) {
      for (const record of stats.activeThreeLife[tracker.name][pid - 1].values()) {
        stats.threeLife[tracker.name].push({ outcome: "aliveAtEnd", elapsed: round - record.formedRound,
          hasRank2: record.hasRank2, contiguous: record.contiguous, bothEndsOpen: record.bothEndsOpen });
      }
    }
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
  let previousSecondBridge = null;
  for (let round = 1; round <= 100; round++) {
    const first = TURN_ORDER_MODE === "fixed" ? fixedStartingPlayer : round % 2 ? 1 : 2;
    stats.roundFirstPlayer = first;
    let actions = 0;
    let firstEstablishedFive = false;
    let secondEstablishedFive = false;
    let crossRoundCandidate = null;
    let nextSecondBridge = null;
    for (const [actionIndex, pid] of [first, 3 - first].entries()) {
      const beforeWindows = fiveWindowStates(board, pid);
      const previousDeploymentPresent = actionIndex === 0 && previousSecondBridge?.pid === pid
        && board[previousSecondBridge.deployment?.r]?.[previousSecondBridge.deployment?.c]?.pid === pid;
      stats.lastDeployment = null;
      startTurn(players[pid - 1]);
      actions += takeAction(board, players, pid, pid === 1 ? style1 : style2, stats, round);
      trackFormations(board, stats, "action", round);
      const deployment = stats.lastDeployment;
      const afterWindows = fiveWindowStates(board, pid);
      updateFirstFormation(stats, board, pid, round);
      if (players[pid - 1].deck.length === 0) stats.deckZeroPlayers[pid - 1] = true;
      if (actionIndex === 0 && hasFive(board, pid)) {
        firstEstablishedFive = true;
        stats.firstFiveOpportunities++;
        if (previousSecondBridge?.pid === pid && previousDeploymentPresent) {
          const completedKeys = [...afterWindows.values()]
            .filter(window => window.own === 5
              && windowContains(window, deployment)
              && windowContains(window, previousSecondBridge.deployment)
              && (deployment.r !== previousSecondBridge.deployment.r || deployment.c !== previousSecondBridge.deployment.c))
            .map(window => window.key);
          const fourToFive = completedKeys.some(key => {
            const before = beforeWindows.get(key);
            return before?.own === 4 && before.enemy === 0 && before.longestOwn === 4;
          });
          const threeToFive = completedKeys.some(key => previousSecondBridge.threeToFourKeys.has(key));
          if (completedKeys.length) crossRoundCandidate = { pid, fourToFive, threeToFive };
        }
      }
      if (actionIndex === 1 && hasFive(board, pid)) {
        secondEstablishedFive = true;
        stats.secondFiveOpportunities++;
      }
      if (actionIndex === 1) {
        const threeToFourKeys = new Set([...afterWindows.values()]
          .filter(window => {
            const before = beforeWindows.get(window.key);
            return window.own === 4 && window.enemy === 0 && window.longestOwn === 4
              && before?.own === 3 && before.enemy === 0 && before.longestOwn === 3
              && windowContains(window, deployment);
          })
          .map(window => window.key));
        nextSecondBridge = { pid, deployment, threeToFourKeys };
      }
    }
    resolveCombat(board, players, stats, round);
    trackFormations(board, stats, "combat", round);
    stats.boardUnitsAtRound[round] = board.flat().filter(Boolean).length;
    stats.boardUnitRoundSum += board.flat().filter(Boolean).length;
    stats.boardUnitSamples++;
    const p1 = hasFive(board, 1), p2 = hasFive(board, 2);
    if ((p1 || p2) && stats.fiveBoardUnits === null) stats.fiveBoardUnits = board.flat().filter(Boolean).length;
    if (firstEstablishedFive && !hasFive(board, first)) stats.firstFiveBrokenBySecond++;
    if (p1 || p2) {
      const winner = p1 && p2 ? 0 : p1 ? 1 : 2;
      if (secondEstablishedFive && winner === 3 - first) stats.secondFiveDirectWins++;
      if (crossRoundCandidate && winner === crossRoundCandidate.pid) {
        stats.crossRoundWins++;
        if (crossRoundCandidate.fourToFive) stats.crossRoundFourToFiveWins++;
        if (crossRoundCandidate.threeToFive) stats.crossRoundThreeToFiveWins++;
      }
      return finish(winner, round, p1, p2);
    }
    if (!actions) {
      return finish(0, round, false, false);
    }
    previousSecondBridge = nextSecondBridge;
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
  firstWins: 0, secondWins: 0, draws: 0,
  firstFiveOpportunities: 0, firstFiveBrokenBySecond: 0,
  secondFiveOpportunities: 0, secondFiveDirectWins: 0,
  secondArtilleryShots: 0, secondArtilleryFreshFirstHits: 0,
  crossRoundWins: 0, crossRoundThreeToFiveWins: 0, crossRoundFourToFiveWins: 0,
  formation: {
    first: { 2: { sum: 0, count: 0 }, 3: { sum: 0, count: 0 }, 4: { sum: 0, count: 0 }, fiveThreat: { sum: 0, count: 0 } },
    second: { 2: { sum: 0, count: 0 }, 3: { sum: 0, count: 0 }, 4: { sum: 0, count: 0 }, fiveThreat: { sum: 0, count: 0 } },
  },
  regionRace: {
    center3: { first: 0, second: 0 }, center: { first: 0, second: 0 }, keyCross: { first: 0, second: 0 },
  },
  normalBlocks: { first: 0, second: 0 },
  firstWinFeatures: { pureFiveSpeed: 0, combatKillAdvantage: 0, artilleryImpact: 0, highRankFinalFive: 0, keyCellFinalFive: 0 },
  openingCells: {},
};
const roleStarts = TURN_ORDER_MODE === "fixed" ? [1, 2] : [1];
const samplesPerMatchup = games * roleStarts.length;
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
    const typesByPid = [{ sword: 0, shield: 0, spear: 0 }, { sword: 0, shield: 0, spear: 0 }];
    const economyTotals = [newRank2Economy(), newRank2Economy()];
    economyTotals.forEach(item => { item.firstRoundSum = 0; item.firstRoundGames = 0; item.secondRoundSum = 0; item.secondRoundGames = 0; });
    const byStart = { 1: { p1: 0, p2: 0, draw: 0, games: 0 }, 2: { p1: 0, p2: 0, draw: 0, games: 0 } };
    const pace = {
      threeRuns: 0, fourRuns: 0, deployments: 0, finalUnits: 0,
      fourBreaks: { completed: 0, blocked: 0, killedInCombat: 0, killedByArtillery: 0, other: 0 },
      unitsAtRound: {}, gamesAtRound: {}, fiveUnitsSum: 0, fiveUnitsGames: 0,
      threeTracks: Object.fromEntries(THREE_TRACKERS.map(t => [t.name, {
        counts: { upgradedToFour: 0, blocked: 0, killedInCombat: 0, killedByArtillery: 0, aliveAtEnd: 0 },
        elapsed: [], elapsedByOutcome: {}, contiguous: 0, rank2: 0, bothEndsOpen: 0, endsKnown: 0,
      }])),
    };
    for (let game = 0; game < games; game++) {
      for (const fixedStartingPlayer of roleStarts) {
      const result = play(style1, style2, matchupSeed(style1, style2, game), fixedStartingPlayer);
      wins[result.winner]++;
      for (const tracker of THREE_TRACKERS) {
        const bucket = pace.threeTracks[tracker.name];
        for (const item of result.threeLife[tracker.name]) {
          bucket.counts[item.outcome]++;
          bucket.elapsed.push(item.elapsed);
          (bucket.elapsedByOutcome[item.outcome] = bucket.elapsedByOutcome[item.outcome] || []).push(item.elapsed);
          if (item.contiguous) bucket.contiguous++;
          if (item.hasRank2) bucket.rank2++;
          if (item.bothEndsOpen !== null) { bucket.endsKnown++; if (item.bothEndsOpen) bucket.bothEndsOpen++; }
        }
      }
      pace.threeRuns += result.threeRuns;
      pace.fourRuns += result.fourRuns;
      pace.deployments += result.ranks[1] + result.ranks[2] + result.ranks[3];
      pace.finalUnits += result.boardUnits;
      for (const key of Object.keys(pace.fourBreaks)) pace.fourBreaks[key] += result.fourBreaks[key];
      for (const [round, units] of Object.entries(result.boardUnitsAtRound)) {
        pace.unitsAtRound[round] = (pace.unitsAtRound[round] || 0) + units;
        pace.gamesAtRound[round] = (pace.gamesAtRound[round] || 0) + 1;
      }
      if (result.fiveBoardUnits !== null) { pace.fiveUnitsSum += result.fiveBoardUnits; pace.fiveUnitsGames++; }
      const startBucket = byStart[fixedStartingPlayer];
      startBucket.games++;
      startBucket[result.winner === 0 ? "draw" : `p${result.winner}`]++;
      for (const index of [0, 1]) {
        const from = result.rank2Economy[index], into = economyTotals[index];
        for (const field of ["count", "remainingAfterCraft", "craftSamples", "laterDeploys",
          "exhaustedTurns", "deaths", "survivalRounds", "killedByCounterMajority",
          "counterDamageShareSum", "counterShareSamples", "deathRoundSum", "peakDirsSum",
          "lifetimeDirsSum"]) into[field] += from[field];
        if (from.firstRound !== null) { into.firstRoundSum += from.firstRound; into.firstRoundGames++; }
        if (from.secondRound !== null) { into.secondRoundSum += from.secondRound; into.secondRoundGames++; }
      }
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
      if (result.winner === 0) comparisonTotals.draws++;
      else if (result.winner === result.matchFirstPlayer) comparisonTotals.firstWins++;
      else comparisonTotals.secondWins++;
      comparisonTotals.firstFiveOpportunities += result.firstFiveOpportunities;
      comparisonTotals.firstFiveBrokenBySecond += result.firstFiveBrokenBySecond;
      comparisonTotals.secondFiveOpportunities += result.secondFiveOpportunities;
      comparisonTotals.secondFiveDirectWins += result.secondFiveDirectWins;
      comparisonTotals.secondArtilleryShots += result.secondArtilleryShots;
      comparisonTotals.secondArtilleryFreshFirstHits += result.secondArtilleryFreshFirstHits;
      comparisonTotals.crossRoundWins += result.crossRoundWins;
      comparisonTotals.crossRoundThreeToFiveWins += result.crossRoundThreeToFiveWins;
      comparisonTotals.crossRoundFourToFiveWins += result.crossRoundFourToFiveWins;
      const firstPid = result.matchFirstPlayer, secondPid = 3 - firstPid;
      for (const [role, pid] of [["first", firstPid], ["second", secondPid]]) {
        for (const field of [2, 3, 4, "fiveThreat"]) {
          const value = result.firstFormation[pid - 1][field];
          if (value !== null) {
            comparisonTotals.formation[role][field].sum += value;
            comparisonTotals.formation[role][field].count++;
          }
        }
      }
      for (const region of ["center3", "center", "keyCross"]) {
        const winner = result.regionRace[region];
        if (winner) comparisonTotals.regionRace[region][winner]++;
      }
      comparisonTotals.normalBlocks.first += result.normalBlocks[firstPid - 1];
      comparisonTotals.normalBlocks.second += result.normalBlocks[secondPid - 1];
      if (result.firstWinFeatures) for (const [feature, present] of Object.entries(result.firstWinFeatures)) {
        if (present) comparisonTotals.firstWinFeatures[feature]++;
      }
      if (result.openingCell) {
        comparisonTotals.openingCells[result.openingCell] ||= { games: 0, wins: 0 };
        comparisonTotals.openingCells[result.openingCell].games++;
        if (result.winner === firstPid) comparisonTotals.openingCells[result.openingCell].wins++;
      }
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
      for (const type of Object.keys(types)) {
        types[type] += result.types[type];
        typesByPid[0][type] += result.typesByPid[0][type];
        typesByPid[1][type] += result.typesByPid[1][type];
      }
      }
    }
    matrix[style1][style2] = {
      p1: +(wins[1] / samplesPerMatchup).toFixed(3),
      p2: +(wins[2] / samplesPerMatchup).toFixed(3),
      draw: +(wins[0] / samplesPerMatchup).toFixed(3),
      parityWins,
      rounds: +(rounds / samplesPerMatchup).toFixed(1),
      deaths: +(deaths / samplesPerMatchup).toFixed(1),
      rank2: +(rank2 / samplesPerMatchup).toFixed(1),
      rank3: +(rank3 / samplesPerMatchup).toFixed(2),
      finalBoardUnits: +(boardUnits / samplesPerMatchup).toFixed(2),
      deckZeroGameRate: +(deckZeroGames / samplesPerMatchup).toFixed(3),
      fiveCompletionRate: +(fiveCompleted / samplesPerMatchup).toFixed(3),
      rank2ByType: Object.fromEntries(Object.entries(rank2ByType).map(([type, value]) => [type, +(value / samplesPerMatchup).toFixed(2)])),
      pace: {
        avgDeploymentsPerGame: +(pace.deployments / samplesPerMatchup).toFixed(2),
        avgFinalUnitsPerGame: +(pace.finalUnits / samplesPerMatchup).toFixed(2),
        attritionRate: +(1 - pace.finalUnits / pace.deployments).toFixed(3),
        threeRunsPerGame: +(pace.threeRuns / samplesPerMatchup).toFixed(2),
        fourRunsPerGame: +(pace.fourRuns / samplesPerMatchup).toFixed(2),
        fourBreaks: pace.fourBreaks,
        fourBreakShare: (() => {
          const ended = pace.fourBreaks.completed + pace.fourBreaks.blocked
            + pace.fourBreaks.killedInCombat + pace.fourBreaks.killedByArtillery + pace.fourBreaks.other;
          return ended ? Object.fromEntries(Object.entries(pace.fourBreaks)
            .map(([key, value]) => [key, +(value / ended).toFixed(3)])) : null;
        })(),
        unitsAtRound: Object.fromEntries([4, 6, 8, 10, 12]
          .filter(round => pace.gamesAtRound[round])
          .map(round => [round, {
            avgUnits: +(pace.unitsAtRound[round] / pace.gamesAtRound[round]).toFixed(2),
            gamesStillAlive: +(pace.gamesAtRound[round] / samplesPerMatchup).toFixed(3),
          }])),
        avgUnitsWhenFiveFormed: pace.fiveUnitsGames ? +(pace.fiveUnitsSum / pace.fiveUnitsGames).toFixed(2) : null,
        threeLifecycle: (() => {
          const stat = list => {
            if (!list.length) return null;
            const sorted = [...list].sort((a, b) => a - b);
            const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
            return {
              n: sorted.length,
              mean: +(sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2),
              median: at(0.5), p75: at(0.75), p90: at(0.9),
            };
          };
          return Object.fromEntries(THREE_TRACKERS.map(tracker => {
            const bucket = pace.threeTracks[tracker.name];
            const total = Object.values(bucket.counts).reduce((sum, value) => sum + value, 0);
            return [tracker.name, {
              events: total,
              eventsPerGame: +(total / samplesPerMatchup).toFixed(2),
              share: total ? Object.fromEntries(Object.entries(bucket.counts)
                .map(([key, value]) => [key, +(value / total).toFixed(3)])) : null,
              counts: bucket.counts,
              contiguousShare: total ? +(bucket.contiguous / total).toFixed(3) : null,
              withRank2Share: total ? +(bucket.rank2 / total).toFixed(3) : null,
              bothEndsOpenShare: bucket.endsKnown ? +(bucket.bothEndsOpen / bucket.endsKnown).toFixed(3) : null,
              elapsedOverall: stat(bucket.elapsed),
              elapsedByOutcome: Object.fromEntries(Object.entries(bucket.elapsedByOutcome)
                .map(([key, list]) => [key, stat(list)])),
            }];
          }));
        })(),
      },
      typeMix: Object.fromEntries(typesByPid.map((bucket, index) => {
        const sum = Object.values(bucket).reduce((acc, item) => acc + item, 0);
        return [`p${index + 1}`, Object.fromEntries(Object.entries(bucket)
          .map(([type, value]) => [type, sum ? +(value / sum).toFixed(3) : 0]))];
      })),
      // 先後手分開：byStartingPlayer[k] 是「由 Pk 先手」那一批的結果。
      byStartingPlayer: Object.fromEntries(Object.entries(byStart)
        .filter(([, bucket]) => bucket.games)
        .map(([start, bucket]) => [start, {
          games: bucket.games,
          p1: +(bucket.p1 / bucket.games).toFixed(3),
          p2: +(bucket.p2 / bucket.games).toFixed(3),
          draw: +(bucket.draw / bucket.games).toFixed(3),
        }])),
      rank2Economy: Object.fromEntries(economyTotals.map((item, index) => [`p${index + 1}`, {
        rank2PerGame: +(item.count / samplesPerMatchup).toFixed(3),
        firstRank2GameRate: +(item.firstRoundGames / samplesPerMatchup).toFixed(3),
        avgFirstRank2Round: item.firstRoundGames ? +(item.firstRoundSum / item.firstRoundGames).toFixed(2) : null,
        secondRank2GameRate: +(item.secondRoundGames / samplesPerMatchup).toFixed(3),
        avgSecondRank2Round: item.secondRoundGames ? +(item.secondRoundSum / item.secondRoundGames).toFixed(2) : null,
        avgUsableCardsLeftAfterCraft: item.craftSamples ? +(item.remainingAfterCraft / item.craftSamples).toFixed(2) : null,
        avgLaterDeploysOfCraftedType: item.craftSamples ? +(item.laterDeploys / item.craftSamples).toFixed(2) : null,
        exhaustedTurnsPerGame: +(item.exhaustedTurns / samplesPerMatchup).toFixed(3),
        rank2Deaths: item.deaths,
        rank2DeathRate: item.count ? +(item.deaths / item.count).toFixed(3) : null,
        avgSurvivalRoundsOfDead: item.deaths ? +(item.survivalRounds / item.deaths).toFixed(2) : null,
        killedByCounterRate: item.deaths ? +(item.killedByCounterMajority / item.deaths).toFixed(3) : null,
        avgCounterDamageShare: item.counterShareSamples ? +(item.counterDamageShareSum / item.counterShareSamples).toFixed(3) : null,
        // 原始計數，供報表跨對局正確加權合併（比率不能直接平均）。
        raw: {
          samples: samplesPerMatchup,
          count: item.count,
          deaths: item.deaths,
          survivalRounds: item.survivalRounds,
          deathRoundSum: item.deathRoundSum,
          peakDirsSum: item.peakDirsSum,
          lifetimeDirsSum: item.lifetimeDirsSum,
          killedByCounterMajority: item.killedByCounterMajority,
          counterDamageShareSum: item.counterDamageShareSum,
          counterShareSamples: item.counterShareSamples,
          remainingAfterCraft: item.remainingAfterCraft,
          craftSamples: item.craftSamples,
          laterDeploys: item.laterDeploys,
          exhaustedTurns: item.exhaustedTurns,
          firstRoundSum: item.firstRoundSum,
          firstRoundGames: item.firstRoundGames,
          secondRoundSum: item.secondRoundSum,
          secondRoundGames: item.secondRoundGames,
        },
      }])),
      artillery: artillery.map(value => +(value / samplesPerMatchup).toFixed(2)),
      artilleryGameRate: artilleryGames.map(value => +(value / samplesPerMatchup).toFixed(3)),
      artilleryTurnRate: artillery.map(value => +(value / rounds).toFixed(3)),
      artilleryKills: +(artilleryKills / samplesPerMatchup).toFixed(2),
      artilleryEventStats: {
        shots: artilleryEventTotals.shots,
        preventedFourPerGame: +(artilleryEventTotals.preventedFour / samplesPerMatchup).toFixed(3),
        preventedFivePerGame: +(artilleryEventTotals.preventedFive / samplesPerMatchup).toFixed(3),
        directKillShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.directKillShots / artilleryEventTotals.shots).toFixed(3) : 0,
        createdSpaceShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.createdSpaceShots / artilleryEventTotals.shots).toFixed(3) : 0,
        hitTwoEnemyShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.hitTwoEnemyShots / artilleryEventTotals.shots).toFixed(3) : 0,
        friendlyHitShotRate: artilleryEventTotals.shots ? +(artilleryEventTotals.friendlyHitShots / artilleryEventTotals.shots).toFixed(3) : 0,
      },
      rank2Metrics: Object.fromEntries(Object.entries(rank2Detail).map(([type, detail]) => [type, {
        deployments: detail.deployments,
        trackedUnits: detail.completed,
        deploymentsPerGame: +(detail.deployments / samplesPerMatchup).toFixed(3),
        avgSurvivalRounds: detail.completed ? +(detail.survivalRounds / detail.completed).toFixed(2) : 0,
        avgDamageTaken: detail.completed ? +(detail.damageTaken / detail.completed).toFixed(2) : 0,
        avgDamageDealt: detail.completed ? +(detail.damageDealt / detail.completed).toFixed(2) : 0,
        finalFiveParticipationRate: detail.deployments ? +(detail.finalFiveParticipants / detail.deployments).toFixed(3) : 0,
        finalFiveParticipants: detail.finalFiveParticipants,
      }])),
      types: Object.fromEntries(Object.entries(types).map(([type, value]) => [type, +(value / samplesPerMatchup).toFixed(1)])),
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
const formationSummary = Object.fromEntries(["first", "second"].map(role => [role,
  Object.fromEntries([2, 3, 4, "fiveThreat"].map(field => {
    const metric = comparisonTotals.formation[role][field];
    return [field, {
      averageRound: metric.count ? +(metric.sum / metric.count).toFixed(3) : null,
      formationRate: +(metric.count / comparisonTotals.games).toFixed(4),
      samples: metric.count,
    }];
  }))
]));
const regionRaceSummary = Object.fromEntries(["center3", "center", "keyCross"].map(region => {
  const race = comparisonTotals.regionRace[region], claimed = race.first + race.second;
  return [region, {
    firstClaimRateAllGames: +(race.first / comparisonTotals.games).toFixed(4),
    secondClaimRateAllGames: +(race.second / comparisonTotals.games).toFixed(4),
    firstShareWhenClaimed: claimed ? +(race.first / claimed).toFixed(4) : null,
    claimedGames: claimed,
  }];
}));
const firstWinFeatureSummary = Object.fromEntries(Object.entries(comparisonTotals.firstWinFeatures)
  .map(([feature, count]) => [feature, { count, rate: comparisonTotals.firstWins ? +(count / comparisonTotals.firstWins).toFixed(4) : 0 }]));
const openingCellSummary = Object.fromEntries(Object.entries(comparisonTotals.openingCells)
  .sort((a, b) => b[1].games - a[1].games)
  .map(([cell, value]) => [cell, { ...value, firstWinRate: +(value.wins / value.games).toFixed(4) }]));
const comparisonSummary = {
  deckSize: DECK_SIZE,
  turnOrderMode: TURN_ORDER_MODE,
  experiment: { disableArtillery: DISABLE_ARTILLERY, disableRanks: DISABLE_RANKS, forcedOpening: FORCED_OPENING?.join(",") || null },
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
  firstPlayerWinRate: +(comparisonTotals.firstWins / comparisonTotals.games).toFixed(4),
  secondPlayerWinRate: +(comparisonTotals.secondWins / comparisonTotals.games).toFixed(4),
  drawRate: +(comparisonTotals.draws / comparisonTotals.games).toFixed(4),
  firstFiveBrokenBySecondRate: comparisonTotals.firstFiveOpportunities
    ? +(comparisonTotals.firstFiveBrokenBySecond / comparisonTotals.firstFiveOpportunities).toFixed(4) : 0,
  firstFiveOpportunities: comparisonTotals.firstFiveOpportunities,
  firstFiveBrokenBySecond: comparisonTotals.firstFiveBrokenBySecond,
  secondFiveDirectWinRate: comparisonTotals.secondFiveOpportunities
    ? +(comparisonTotals.secondFiveDirectWins / comparisonTotals.secondFiveOpportunities).toFixed(4) : 0,
  secondFiveOpportunities: comparisonTotals.secondFiveOpportunities,
  secondFiveDirectWins: comparisonTotals.secondFiveDirectWins,
  secondArtilleryFreshFirstHitRate: comparisonTotals.secondArtilleryShots
    ? +(comparisonTotals.secondArtilleryFreshFirstHits / comparisonTotals.secondArtilleryShots).toFixed(4) : 0,
  secondArtilleryShots: comparisonTotals.secondArtilleryShots,
  secondArtilleryFreshFirstHits: comparisonTotals.secondArtilleryFreshFirstHits,
  crossRoundConsecutiveWinRate: (comparisonTotals.firstWins + comparisonTotals.secondWins)
    ? +(comparisonTotals.crossRoundWins / (comparisonTotals.firstWins + comparisonTotals.secondWins)).toFixed(4) : 0,
  crossRoundWins: comparisonTotals.crossRoundWins,
  crossRoundThreeToFiveWins: comparisonTotals.crossRoundThreeToFiveWins,
  crossRoundFourToFiveWins: comparisonTotals.crossRoundFourToFiveWins,
  firstFormation: formationSummary,
  regionRace: regionRaceSummary,
  averageNormalBlocks: {
    first: +(comparisonTotals.normalBlocks.first / comparisonTotals.games).toFixed(3),
    second: +(comparisonTotals.normalBlocks.second / comparisonTotals.games).toFixed(3),
  },
  firstWinFeatures: firstWinFeatureSummary,
  openingCells: openingCellSummary,
};
console.log(JSON.stringify({ seedPairsPerMatchup: games, samplesPerMatchup, seedPolicy: "fixed-fnv1a-v1", comparisonSummary, matrix, causalArtillery }, null, 2));
