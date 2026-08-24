// 假設：劍的單目標決鬥倍率在「目標為盾」時改為 M。其他完全不變。
// 作法同前：呼叫正式 resolveCombat 前把該劍 ATK 乘上 M/1.5，引擎再乘 ×1.5 即得 ATK×M。
// 不重寫傷害結算、不改 game_engine.js。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];

class SweepEngine extends GameEngine {
  resolveCombat() {
    const patched = [];
    const m = this.duelVsShield;
    if (m !== undefined && m !== 1.5) {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const unit = this.board[r][c];
        if (!unit || unit.type !== "sword") continue;
        const targets = this.attackTargets(r, c, unit);
        if (targets.length !== 1) continue;
        if (this.board[targets[0][0]][targets[0][1]].type !== "shield") continue;
        patched.push([unit, unit.atk]);
        unit.atk = unit.atk * m / 1.5;
      }
    }
    const result = super.resolveCombat();
    for (const [unit, atk] of patched) unit.atk = atk;
    return result;
  }
}

const mk = (pid, type, rank, id) => {
  const s = baseStats(type, rank);
  return { id, pid, type, rank, cards: cardCost(rank), hp: s.maxHp, maxHp: s.maxHp, atk: s.atk };
};

function battle({ defType, defRank, atkType, attackers, duelVsShield, staged }) {
  const e = new SweepEngine({});
  e.duelVsShield = duelVsShield;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  const core = mk(1, defType, defRank, 0);
  e.board[4][4] = core;
  let placed = 0;
  if (!staged) for (; placed < attackers; placed++) {
    e.board[4 + ADJ[placed][0]][4 + ADJ[placed][1]] = mk(2, atkType, 1, placed + 1);
  }
  let defDeath = null;
  const atkDeath = new Map();
  for (let tick = 1; tick <= 80; tick++) {
    if (staged && placed < attackers) {
      const slot = ADJ.find(([dr, dc]) => !e.board[4 + dr][4 + dc]);
      if (slot) e.board[4 + slot[0]][4 + slot[1]] = mk(2, atkType, 1, ++placed);
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
    survivors.push(`${u.pid === 1 ? "守" : "攻"}${"★".repeat(u.rank)}${NAME[u.type]}${Math.max(0, u.hp)}`);
  }
  return {
    defDeath, killed: defDeath !== null, atkDeaths: atkDeath.size, placed, survivors,
    coreHp: Math.max(0, core.hp),
    mutual: defDeath !== null && atkDeath.size === placed && [...atkDeath.values()].includes(defDeath),
  };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605→]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const MULTS = [1.0, 1.15, 1.25, 1.5];
const tag = m => (m === 1.5 ? "×1.5(現行)" : `×${m}`);

console.log("=".repeat(100));
console.log("表 1  1★盾 vs 1★劍 單挑");
console.log("=".repeat(100));
console.log(w("決鬥倍率", 14) + w("死亡輪", 12) + w("勝方", 14) + w("勝方剩餘 HP", 16) + "備註");
console.log("-".repeat(100));
for (const m of MULTS) {
  const r = battle({ defType: "shield", defRank: 1, atkType: "sword", attackers: 1, duelVsShield: m, staged: true });
  const winner = r.mutual ? "無（同歸於盡）" : r.killed ? "劍" : "盾";
  const hp = r.mutual ? "-" : r.survivors.length ? r.survivors[0].replace(/[^0-9]/g, "") : "-";
  console.log(w(tag(m), 14) + w(r.killed ? `第 ${r.defDeath} 輪` : "盾不死", 12)
    + w(winner, 14) + w(hp, 16) + (r.survivors.join(" ") || "全滅"));
}

for (const staged of [true, false]) {
  console.log("");
  console.log("=".repeat(100));
  console.log(`表 2${staged ? "a" : "b"}  ★★盾 被 N 隻 1★劍圍攻（守方不增援，${staged ? "攻方每輪到位 1 顆" : "一開始就完整包圍"}）`);
  console.log("=".repeat(100));
  console.log(w("決鬥倍率", 14) + w("劍數", 8) + w("能否拆除", 14) + w("拆除輪", 10)
    + w("攻方陣亡", 10) + w("盾剩餘 HP", 12) + "最終戰場");
  console.log("-".repeat(100));
  for (const m of MULTS) {
    for (const n of [1, 2, 3, 4]) {
      const r = battle({ defType: "shield", defRank: 2, atkType: "sword", attackers: n, duelVsShield: m, staged });
      console.log(w(n === 1 ? tag(m) : "", 14) + w(`${n} 隻`, 8)
        + w(r.killed ? "可拆" : "拆不掉", 14)
        + w(r.killed ? `第 ${r.defDeath} 輪` : "-", 10)
        + w(`${r.atkDeaths}/${r.placed} 顆`, 10)
        + w(r.killed ? "0" : String(r.coreHp), 12)
        + (r.survivors.join(" ") || "全滅"));
    }
  }
}

console.log("");
console.log("=".repeat(100));
console.log("表 3  劍→槍 與 槍→盾 是否受影響（不含盾為單目標的劍攻擊，應完全不變）");
console.log("=".repeat(100));
console.log(w("情境", 16) + MULTS.map(m => w(tag(m), 20)).join(""));
console.log("-".repeat(100));
for (const [defType, atkType, label] of [
  ["spear", "sword", "劍→槍"], ["shield", "spear", "槍→盾"],
  ["sword", "sword", "劍 vs 劍"], ["spear", "spear", "槍 vs 槍"],
]) {
  const cells = MULTS.map(m => {
    const r = battle({ defType, defRank: 1, atkType, attackers: 1, duelVsShield: m, staged: true });
    return w((r.killed ? `第${r.defDeath}輪` : "不死") + "/" + (r.survivors.join("") || "全滅"), 20);
  });
  console.log(w(label, 16) + cells.join("") + (new Set(cells).size === 1 ? "  不變 ✓" : "  改變 ✗"));
}
