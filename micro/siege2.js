// 雙方逐輪增援的 deterministic 圍攻測試。使用 game_engine.js 的正式規則。
// 每輪：攻方部署 1 顆 → 守方部署 1 顆 → 正式 resolveCombat。
// 全部決策只讀棋盤（兵種／星級／位置／HP），不碰手牌或牌庫。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");

const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const COUNTERED_BY = type => Object.keys(COUNTER).find(key => COUNTER[key] === type);
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const CORE = [4, 4];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

const mk = (pid, type, rank, id) => {
  const s = baseStats(type, rank);
  return { id, pid, type, rank, cards: cardCost(rank), hp: s.maxHp, maxHp: s.maxHp, atk: s.atk };
};

// 若把 type 放在 (r,c)，能不能打到 (tr,tc)？依正式射程規則。
function canAttack(board, r, c, type, tr, tc) {
  for (const [dr, dc] of DIRS) {
    if (type === "spear") {
      for (let d = 1; d <= 2; d++) {
        const rr = r + dr * d, cc = c + dc * d;
        if (!inB(rr, cc)) break;
        if (rr === tr && cc === tc) return true;
        if (board[rr][cc]) break;                    // 被擋住
      }
    } else if (r + dr === tr && c + dc === tc) return true;
  }
  return false;
}

const emptyCells = board => {
  const out = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!board[r][c]) out.push([r, c]);
  return out;
};

// 目前正在攻擊核心的敵方單位
function coreAttackers(board) {
  const out = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const unit = board[r][c];
    if (unit?.pid === 2 && canAttack(board, r, c, unit.type, CORE[0], CORE[1])) out.push([r, c]);
  }
  return out;
}

// 攻方：優先佔核心正交相鄰的空格；其次距離 2 且中間空（槍才有意義）；再次貼守方援軍。
function attackerCell(board, type) {
  for (const [dr, dc] of DIRS) {
    const [r, c] = [CORE[0] + dr, CORE[1] + dc];
    if (inB(r, c) && !board[r][c]) return [r, c];
  }
  for (const [r, c] of emptyCells(board)) {
    if (canAttack(board, r, c, type, CORE[0], CORE[1])) return [r, c];
  }
  for (const [r, c] of emptyCells(board)) {
    for (const [dr, dc] of DIRS) {
      const target = inB(r + dr, c + dc) && board[r + dr][c + dc];
      if (target && target.pid === 1) return [r, c];
    }
  }
  return null;
}

// 守方增援優先序（題目指定）：
//   1. 能直接攻擊「正在威脅核心的敵人」
//   2. 能保護核心（佔住核心相鄰空格＝擋掉圍攻位，盾還額外提供傷害轉移）
//   3. 其他（貼近核心）
function defenderCell(board, type) {
  const threats = coreAttackers(board);
  for (const [r, c] of emptyCells(board)) {
    if (threats.some(([tr, tc]) => canAttack(board, r, c, type, tr, tc))) return { cell: [r, c], reason: "反擊圍攻者" };
  }
  for (const [dr, dc] of DIRS) {
    const [r, c] = [CORE[0] + dr, CORE[1] + dc];
    if (inB(r, c) && !board[r][c]) return { cell: [r, c], reason: "佔位護核" };
  }
  for (const [r, c] of emptyCells(board)) {
    if (Math.max(Math.abs(r - CORE[0]), Math.abs(c - CORE[1])) <= 2) return { cell: [r, c], reason: "靠近核心" };
  }
  return null;
}

function run({ coreType, coreRank, atkType, atkCap, defType, defends, label }) {
  const e = new GameEngine({});
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  e.board[CORE[0]][CORE[1]] = mk(1, coreType, coreRank, 0);
  let atkDeployed = 0, defDeployed = 0, nextId = 1;
  let atkDead = 0, defDead = 0;
  let atkDeploysAtKill = null, killRound = null;
  const seen = new Map();

  for (let round = 1; round <= 40; round++) {
    if (atkDeployed < atkCap) {
      const cell = attackerCell(e.board, atkType);
      if (cell) { const u = mk(2, atkType, 1, nextId++); e.board[cell[0]][cell[1]] = u; seen.set(u.id, 2); atkDeployed++; }
    }
    if (defends) {
      const pick = defenderCell(e.board, defType);
      if (pick) { const u = mk(1, defType, 1, nextId++); e.board[pick.cell[0]][pick.cell[1]] = u; seen.set(u.id, 1); defDeployed++; }
    }
    e.resolveCombat();
    const alive = new Set();
    for (const row of e.board) for (const u of row) if (u) alive.add(u.id);
    atkDead = [...seen].filter(([id, pid]) => pid === 2 && !alive.has(id)).length;
    defDead = [...seen].filter(([id, pid]) => pid === 1 && !alive.has(id)).length;
    if (!alive.has(0)) { killRound = round; atkDeploysAtKill = atkDeployed; break; }
    if (atkDeployed >= atkCap && [...seen].filter(([id, pid]) => pid === 2).every(([id]) => !alive.has(id))) break;
  }

  const survivors = [];
  for (const row of e.board) for (const u of row) if (u) {
    survivors.push(`${u.pid === 1 ? "守" : "攻"}${"★".repeat(u.rank)}${NAME[u.type]}${Math.max(0, u.hp)}`);
  }
  return { label, killRound, atkDeployed, defDeployed, atkDead, defDead, survivors, killed: killRound !== null, atkDeploysAtKill };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };

const CORES = [["sword", 1], ["shield", 1], ["spear", 1], ["sword", 2], ["shield", 2], ["spear", 2]];

console.log("=".repeat(120));
console.log("表 A  公平節奏：雙方都不設上限，每輪各部署 1 顆（攻方先手）");
console.log("=".repeat(120));
console.log(w("核心", 12) + w("攻方兵種", 10) + w("守方援軍", 10) + w("結果", 12)
  + w("攻方部署", 10) + w("守方增援", 10) + w("攻方陣亡", 10) + w("守方陣亡", 10) + "最終剩餘");
console.log("-".repeat(120));
for (const [coreType, coreRank] of CORES) {
  const atkType = COUNTERED_BY(coreType), defType = COUNTERED_BY(atkType);
  const r = run({ coreType, coreRank, atkType, atkCap: 12, defType, defends: true });
  console.log(w(`${"★".repeat(coreRank)}${NAME[coreType]}`, 12) + w(NAME[atkType], 10) + w(NAME[defType], 10)
    + w(r.killed ? `第 ${r.killRound} 輪拆除` : "核心存活", 12)
    + w(r.atkDeployed + " 顆", 10) + w(r.defDeployed + " 顆", 10)
    + w(r.atkDead + " 顆", 10) + w(r.defDead + " 顆", 10)
    + (r.survivors.join(" ") || "全滅"));
}

console.log("");
console.log("=".repeat(120));
console.log("表 B  拆除成本掃描：守方每輪都增援，攻方最少要投入幾顆才拆得掉核心");
console.log("=".repeat(120));
console.log(w("核心", 12) + w("攻方", 8) + w("援軍", 8) + w("無增援時所需", 14)
  + w("有增援時所需", 14) + w("拆除輪", 10) + w("攻方陣亡", 10) + w("守方增援投入", 14) + "判讀");
console.log("-".repeat(120));
for (const [coreType, coreRank] of CORES) {
  const atkType = COUNTERED_BY(coreType), defType = COUNTERED_BY(atkType);
  const findMin = defends => {
    for (let cap = 1; cap <= 12; cap++) {
      const r = run({ coreType, coreRank, atkType, atkCap: cap, defType, defends });
      if (r.killed) return { cap, r };
    }
    return null;
  };
  const solo = findMin(false), guarded = findMin(true);
  const verdict = !guarded ? "12 顆以內拆不掉"
    : guarded.cap <= (solo ? solo.cap : 99) ? "增援沒有拖慢拆除"
    : `增援讓成本 +${guarded.cap - solo.cap} 顆`;
  console.log(w(`${"★".repeat(coreRank)}${NAME[coreType]}`, 12) + w(NAME[atkType], 8) + w(NAME[defType], 8)
    + w(solo ? solo.cap + " 顆" : "拆不掉", 14)
    + w(guarded ? guarded.cap + " 顆" : "拆不掉", 14)
    + w(guarded ? `第 ${guarded.r.killRound} 輪` : "-", 10)
    + w(guarded ? guarded.r.atkDead + " 顆" : "-", 10)
    + w(guarded ? guarded.r.defDeployed + " 顆" : "-", 14) + verdict);
}
