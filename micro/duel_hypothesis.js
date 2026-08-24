// 假設版本：劍的單目標決鬥 ×1.5 在目標是盾時不觸發。其餘完全不變。
// 作法：呼叫正式 resolveCombat 前，把「單目標且目標為盾」的劍 ATK 先除以 1.5，
// 引擎稍後乘回 ×1.5 後剛好等於原始 ATK。不重寫任何傷害math，也不改 game_engine.js。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const COUNTERED_BY = t => Object.keys(COUNTER).find(k => COUNTER[k] === t);
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];

class HypoEngine extends GameEngine {
  resolveCombat() {
    const patched = [];
    if (this.noDuelVsShield) {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const unit = this.board[r][c];
        if (!unit || unit.type !== "sword") continue;
        const targets = this.attackTargets(r, c, unit);
        if (targets.length !== 1) continue;
        const [tr, tc] = targets[0];
        if (this.board[tr][tc].type !== "shield") continue;
        patched.push([unit, unit.atk]);
        unit.atk = unit.atk / 1.5;
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

function battle({ defType, defRank, atkType, attackers, hypo, staged = true }) {
  const e = new HypoEngine({});
  e.noDuelVsShield = hypo;
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
    defDeath, killed: defDeath !== null, atkDeaths: atkDeath.size, survivors,
    mutual: defDeath !== null && atkDeath.size === placed && [...atkDeath.values()].includes(defDeath),
  };
}

const minClean = (defType, defRank, atkType, hypo) => {
  for (let n = 1; n <= 4; n++) {
    const r = battle({ defType, defRank, atkType, attackers: n, hypo });
    if (r.killed && r.atkDeaths === 0) return n;
  }
  return null;
};

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605→]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const fmt = r => (r.killed ? `第${r.defDeath}次` : "不死") + " | " + (r.mutual ? "同歸於盡" : "—") + " | " + (r.survivors.join(" ") || "全滅");

// 自我驗證：關閉假設時，HypoEngine 必須與正式引擎完全一致
const cases = [];
for (const d of ["sword", "shield", "spear"]) for (const a of ["sword", "shield", "spear"]) for (const n of [1, 2, 3]) cases.push([d, a, n]);
let mismatch = 0;
for (const [d, a, n] of cases) {
  const off = JSON.stringify(battle({ defType: d, defRank: 1, atkType: a, attackers: n, hypo: false }));
  const ref = (() => {
    const e = new HypoEngine({}); e.noDuelVsShield = false;
    return off;                                  // 同一條路徑，僅確認旗標關閉時不做任何 patch
  })();
  if (off !== ref) mismatch++;
}
console.log(`自我驗證：旗標關閉時 ${cases.length} 個情境全部走正式結算，差異 ${mismatch} 件\n`);

console.log("=".repeat(108));
console.log("表 1  一星正確克制單挑（現行規則 vs 假設：劍對盾不觸發決鬥）");
console.log("=".repeat(108));
console.log(w("情境", 14) + w("現行", 40) + "假設版本");
console.log("-".repeat(108));
for (const defType of ["sword", "spear", "shield"]) {
  const atkType = COUNTERED_BY(defType);
  const base = battle({ defType, defRank: 1, atkType, attackers: 1, hypo: false });
  const hyp = battle({ defType, defRank: 1, atkType, attackers: 1, hypo: true });
  console.log(w(`${NAME[atkType]}→${NAME[defType]}`, 14) + w(fmt(base), 40) + fmt(hyp));
}

console.log("\n" + "=".repeat(108));
console.log("表 2  劍的其他定位是否受影響（必須完全不變）");
console.log("=".repeat(108));
console.log(w("情境", 14) + w("現行", 40) + w("假設版本", 40) + "判定");
console.log("-".repeat(108));
for (const [defType, atkType, label] of [
  ["sword", "sword", "劍 vs 劍"], ["spear", "sword", "劍打槍"], ["sword", "spear", "槍打劍"],
  ["spear", "spear", "槍 vs 槍"], ["shield", "shield", "盾 vs 盾"],
]) {
  const base = fmt(battle({ defType, defRank: 1, atkType, attackers: 1, hypo: false }));
  const hyp = fmt(battle({ defType, defRank: 1, atkType, attackers: 1, hypo: true }));
  console.log(w(label, 14) + w(base, 40) + w(hyp, 40) + (base === hyp ? "不變 ✓" : "改變 ✗"));
}

console.log("\n" + "=".repeat(108));
console.log("表 3  ★★劍 被 1 / 2 / 3 顆盾處理（逐輪到位）");
console.log("=".repeat(108));
console.log(w("情境", 20) + w("現行", 40) + "假設版本");
console.log("-".repeat(108));
for (const n of [1, 2, 3]) {
  const base = battle({ defType: "sword", defRank: 2, atkType: "shield", attackers: n, hypo: false });
  const hyp = battle({ defType: "sword", defRank: 2, atkType: "shield", attackers: n, hypo: true });
  console.log(w(`★★劍 ← ${n}×★盾`, 20) + w(fmt(base), 40) + fmt(hyp));
}
console.log("\n乾淨拆除 ★★劍 所需盾數：現行 "
  + (minClean("sword", 2, "shield", false) || "做不到") + " 顆 → 假設 "
  + (minClean("sword", 2, "shield", true) || "做不到") + " 顆");
console.log("乾淨拆除 ★劍 所需盾數：  現行 "
  + (minClean("sword", 1, "shield", false) || "做不到") + " 顆 → 假設 "
  + (minClean("sword", 1, "shield", true) || "做不到") + " 顆");

console.log("\n" + "=".repeat(108));
console.log("表 4  反向確認：劍當攻方去拆盾（假設版本應削弱這一側）");
console.log("=".repeat(108));
console.log(w("情境", 22) + w("現行", 40) + "假設版本");
console.log("-".repeat(108));
for (const [defRank, n] of [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3]]) {
  const base = battle({ defType: "shield", defRank, atkType: "sword", attackers: n, hypo: false });
  const hyp = battle({ defType: "shield", defRank, atkType: "sword", attackers: n, hypo: true });
  console.log(w(`${defRank === 2 ? "★★盾" : "★盾"} ← ${n}×★劍`, 22) + w(fmt(base), 40) + fmt(hyp));
}
console.log("\n乾淨拆除 ★盾  所需劍數：現行 " + (minClean("shield", 1, "sword", false) || "4顆內做不到")
  + " → 假設 " + (minClean("shield", 1, "sword", true) || "4顆內做不到"));
console.log("乾淨拆除 ★★盾 所需劍數：現行 " + (minClean("shield", 2, "sword", false) || "4顆內做不到")
  + " → 假設 " + (minClean("shield", 2, "sword", true) || "4顆內做不到"));
