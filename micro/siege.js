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

const scenarios = [];
for (const [coreType, coreRank, atkCap, tag] of [
  ["sword", 1, 4, "1★核心·被正確克制"],
  ["shield", 1, 4, "1★核心·被正確克制"],
  ["spear", 1, 4, "1★核心·被正確克制"],
  ["sword", 2, 4, "2★核心·被正確克制"],
  ["shield", 2, 4, "2★核心·被正確克制"],
  ["spear", 2, 4, "2★核心·被正確克制"],
  ["sword", 2, 2, "2★·兩面包夾"],
  ["shield", 2, 2, "2★·兩面包夾"],
  ["spear", 2, 2, "2★·兩面包夾"],
  ["sword", 2, 3, "2★·三面包夾"],
  ["shield", 2, 3, "2★·三面包夾"],
  ["spear", 2, 3, "2★·三面包夾"],
]) {
  const atkType = COUNTERED_BY(coreType);       // 攻方＝剋制核心的兵種
  const defType = COUNTERED_BY(atkType);        // 援軍＝剋制攻方的兵種
  scenarios.push({ coreType, coreRank, atkType, atkCap, defType, tag });
}

console.log("=".repeat(122));
console.log("雙方逐輪增援圍攻測試（攻方先部署 → 守方部署 → 正式 resolveCombat）");
console.log("核心＝守方錨點；攻方＝剋制核心的兵種；守方援軍＝剋制攻方的兵種");
console.log("=".repeat(122));
console.log(w("場景", 22) + w("核心", 10) + w("攻方", 8) + w("援軍", 8) + w("守方增援", 10)
  + w("拆除輪", 10) + w("攻方部署", 10) + w("守方增援數", 12) + w("攻方陣亡", 10) + w("守方陣亡", 10) + "最終剩餘");
console.log("-".repeat(122));
for (const s of scenarios) {
  for (const defends of [false, true]) {
    const r = run({ ...s, defends });
    console.log(w(s.tag, 22)
      + w(`${"★".repeat(s.coreRank)}${NAME[s.coreType]}`, 10)
      + w(`${NAME[s.atkType]}×${s.atkCap}`, 8)
      + w(NAME[s.defType], 8)
      + w(defends ? "有" : "無(對照)", 10)
      + w(r.killed ? `第 ${r.killRound} 輪` : "未拆除", 10)
      + w(r.atkDeployed + " 顆", 10)
      + w(r.defDeployed + " 顆", 12)
      + w(r.atkDead + " 顆", 10)
      + w(r.defDead + " 顆", 10)
      + (r.survivors.join(" ") || "全滅"));
  }
}
