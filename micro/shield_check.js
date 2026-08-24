// 盾減傷移除前後的對照測試。全部使用 game_engine.js 的正式規則。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const COUNTERED_BY = t => Object.keys(COUNTER).find(k => COUNTER[k] === t);
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const mk = (pid, type, rank, id) => {
  const s = baseStats(type, rank);
  return { id, pid, type, rank, cards: cardCost(rank), hp: s.maxHp, maxHp: s.maxHp, atk: s.atk };
};

// staged=false：攻方一開始就全部到位。staged=true：每輪部署 1 顆。
function battle({ defType, defRank, atkType, attackers, staged }) {
  const e = new GameEngine({});
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  e.board[4][4] = mk(1, defType, defRank, 0);
  let placed = 0;
  if (!staged) for (; placed < attackers; placed++) {
    e.board[4 + ADJ[placed][0]][4 + ADJ[placed][1]] = mk(2, atkType, 1, placed + 1);
  }
  let defDeath = null;
  const atkDeath = new Map();
  for (let tick = 1; tick <= 60; tick++) {
    if (staged && placed < attackers) {
      const slot = ADJ.find(([dr, dc]) => !e.board[4 + dr][4 + dc]);
      if (slot) { e.board[4 + slot[0]][4 + slot[1]] = mk(2, atkType, 1, ++placed); }
    }
    e.resolveCombat();
    const alive = new Set();
    for (const row of e.board) for (const u of row) if (u) alive.add(u.id);
    for (let i = 1; i <= placed; i++) if (!alive.has(i) && !atkDeath.has(i)) atkDeath.set(i, tick);
    if (!alive.has(0)) { defDeath = tick; break; }
    if (placed === attackers && atkDeath.size === attackers) break;
  }
  const survivors = [];
  for (const row of e.board) for (const u of row) if (u) {
    survivors.push({ side: u.pid === 1 ? "守" : "攻", label: `${"★".repeat(u.rank)}${NAME[u.type]}`, hp: Math.max(0, u.hp) });
  }
  const mutual = defDeath !== null && [...atkDeath.values()].includes(defDeath) && atkDeath.size === placed;
  return { defDeath, atkDeaths: atkDeath.size, placed, survivors, mutual, killed: defDeath !== null };
}

// 乾淨拆除＝守方死亡且攻方零陣亡。回傳最少需要幾顆。
function minCleanKill(defType, defRank, atkType, staged) {
  for (let n = 1; n <= 4; n++) {
    const r = battle({ defType, defRank, atkType, attackers: n, staged });
    if (r.killed && r.atkDeaths === 0) return n;
  }
  return null;
}

const out = { duelCounter: [], duelMirror: [], siege1: [], siege2: [] };

// 1. 一星正確克制單挑（攻方剋守方）
for (const defType of ["sword", "spear", "shield"]) {
  const atkType = COUNTERED_BY(defType);
  const r = battle({ defType, defRank: 1, atkType, attackers: 1, staged: false });
  out.duelCounter.push({ key: `${NAME[atkType]}→${NAME[defType]}`, ...r });
}
// 2. 一星同兵種單挑
for (const type of ["sword", "shield", "spear"]) {
  const r = battle({ defType: type, defRank: 1, atkType: type, attackers: 1, staged: false });
  out.duelMirror.push({ key: `${NAME[type]} vs ${NAME[type]}`, ...r });
}
// 3. 一星 staged 兩面／三面圍攻（攻方＝剋制兵種）
for (const defType of ["sword", "spear", "shield"]) {
  const atkType = COUNTERED_BY(defType);
  for (const n of [2, 3]) {
    const r = battle({ defType, defRank: 1, atkType, attackers: n, staged: true });
    out.siege1.push({ key: `★${NAME[defType]} ← ${n}×★${NAME[atkType]}`, ...r,
      minClean: minCleanKill(defType, 1, atkType, true) });
  }
}
// 4. ★★ 無增援，被 1/2/3 顆正確克制兵種攻擊（staged 逐輪到位）
for (const defType of ["sword", "spear", "shield"]) {
  const atkType = COUNTERED_BY(defType);
  for (const n of [1, 2, 3]) {
    const r = battle({ defType, defRank: 2, atkType, attackers: n, staged: true });
    out.siege2.push({ key: `★★${NAME[defType]} ← ${n}×★${NAME[atkType]}`, ...r,
      minClean: minCleanKill(defType, 2, atkType, true) });
  }
}
console.log(JSON.stringify(out, null, 1));
