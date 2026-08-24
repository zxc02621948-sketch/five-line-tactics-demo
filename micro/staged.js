// 實戰版：攻方每輪只能部署 1 顆（引擎規則），邊到位邊打。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const mk = (pid, type, rank, id) => {
  const s = baseStats(type, rank);
  return { id, pid, type, rank, cards: cardCost(rank), hp: s.maxHp, maxHp: s.maxHp, atk: s.atk };
};
const cell = (t, w) => {
  let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605]/.test(ch) ? 2 : 1;
  return String(t) + " ".repeat(Math.max(0, w - v));
};

function staged({ defType, defRank, atkType, maxAttackers }) {
  const e = new GameEngine({});
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  e.board[4][4] = mk(1, defType, defRank, 0);
  let placed = 0, atkDeaths = 0;
  for (let round = 1; round <= 40; round++) {
    if (placed < maxAttackers) {                       // 每輪只放一顆
      const [dr, dc] = ADJ[placed];
      if (!e.board[4 + dr][4 + dc]) e.board[4 + dr][4 + dc] = mk(2, atkType, 1, ++placed);
    }
    e.resolveCombat();
    const alive = new Set();
    for (const row of e.board) for (const u of row) if (u) alive.add(u.id);
    atkDeaths = placed - [...alive].filter(id => id !== 0).length;
    if (!alive.has(0)) return { round, placed, atkDeaths, killed: true };
    if (placed === maxAttackers && alive.size === 1) return { round, placed, atkDeaths, killed: false };
  }
  return { round: null, placed, atkDeaths, killed: false };
}

console.log("=".repeat(96));
console.log("表 4  實戰節奏：攻方每輪只放 1 顆，邊到位邊打（含部署期間的損耗）");
console.log("=".repeat(96));
console.log(cell("情境", 32) + cell("投入部署回合", 14) + cell("守方死於第幾輪", 16) + cell("攻方陣亡", 10) + "結果");
console.log("-".repeat(96));
for (const defRank of [1, 2]) for (const defType of ["sword", "shield", "spear"]) {
  for (const atkType of ["sword", "shield", "spear"]) {
    for (const n of [2, 3, 4]) {
      const r = staged({ defType, defRank, atkType, maxAttackers: n });
      if (!r.killed && n !== 4) continue;
      console.log(cell(`守${"★".repeat(defRank)}${NAME[defType]} ← 最多 ${n}×★${NAME[atkType]}`, 32)
        + cell(`${r.placed} 回合`, 14)
        + cell(r.killed ? `第 ${r.round} 輪` : "殺不掉", 16)
        + cell(`${r.atkDeaths} 顆`, 10)
        + (r.killed ? `攻方用 ${r.placed} 個部署回合換掉 1 格` : "圍攻失敗"));
    }
  }
}
