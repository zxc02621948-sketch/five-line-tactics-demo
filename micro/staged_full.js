// 完整 1★ staged 矩陣。攻方每輪只能部署 1 顆（正式規則），每輪跑正式 resolveCombat。
const { GameEngine, baseStats, cardCost } = require("../game_engine.js");
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const TYPES_LIST = ["sword", "shield", "spear"];
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const MAX_ROUNDS = 40;

const mk = (pid, type, id) => {
  const s = baseStats(type, 1);
  return { id, pid, type, rank: 1, cards: cardCost(1), hp: s.maxHp, maxHp: s.maxHp, atk: s.atk };
};

function relation(atk, def) {
  if (COUNTER[atk] === def) return "攻方剋守方";
  if (COUNTER[def] === atk) return "守方反剋攻方";
  return "無克制";
}

function staged(defType, atkType, investment) {
  const e = new GameEngine({});
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  e.board[4][4] = mk(1, defType, 0);
  let deployed = 0;
  const deathRound = new Map();          // 攻方 id -> 陣亡輪
  const arrivalRound = new Map();        // 攻方 id -> 到場輪
  let defenderDeath = null;
  const staleReinforcements = [];        // 第 n 顆到場時，前面已死幾顆

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (deployed < investment) {
      const slot = ADJ.find(([dr, dc]) => !e.board[4 + dr][4 + dc]);
      if (slot) {
        const id = ++deployed;
        e.board[4 + slot[0]][4 + slot[1]] = mk(2, atkType, id);
        arrivalRound.set(id, round);
        if (id > 1) staleReinforcements.push({ id, alreadyDead: deathRound.size });
      }
    }
    e.resolveCombat();
    const alive = new Set();
    for (const row of e.board) for (const unit of row) if (unit) alive.add(unit.id);
    for (const id of arrivalRound.keys()) if (!alive.has(id) && !deathRound.has(id)) deathRound.set(id, round);
    if (!alive.has(0)) { defenderDeath = round; break; }
    if (deployed === investment && deathRound.size === investment) break;   // 攻方全滅
  }

  const survivors = [];
  for (const row of e.board) for (const unit of row) if (unit) {
    survivors.push(`${unit.pid === 1 ? "守" : "攻"}${NAME[unit.type]}${Math.max(0, unit.hp)}`);
  }
  return {
    defenderDeath, deployed, atkDeaths: deathRound.size, survivors,
    staleReinforcements, cannotKill: defenderDeath === null,
  };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };

console.log("=".repeat(112));
console.log("表 1  1★ staged 拆除時間（攻方每輪 1 顆，正式 resolveCombat）");
console.log("=".repeat(112));
console.log(w("守方", 8) + w("攻方", 8) + w("克制關係", 16) + w("投入", 6)
  + w("守方死亡", 12) + w("攻方陣亡", 10) + w("援軍到場前已折損", 18) + "最後剩餘");
console.log("-".repeat(112));
const records = [];
for (const defType of TYPES_LIST) for (const atkType of TYPES_LIST) {
  for (const investment of [1, 2, 3, 4]) {
    const r = staged(defType, atkType, investment);
    records.push({ defType, atkType, investment, ...r, rel: relation(atkType, defType) });
    const stale = r.staleReinforcements.filter(item => item.alreadyDead > 0)
      .map(item => `第${item.id}顆到場時已折損${item.alreadyDead}`).join("；") || "無";
    console.log(w(NAME[defType], 8) + w(NAME[atkType], 8) + w(relation(atkType, defType), 16)
      + w(investment + " 顆", 6)
      + w(r.cannotKill ? "cannot_kill" : `第 ${r.defenderDeath} 輪`, 12)
      + w(r.atkDeaths + " 顆", 10) + w(stale, 18)
      + (r.survivors.join(" ") || "全滅"));
  }
}

console.log("\n" + "=".repeat(112));
console.log("表 2  依克制關係彙總（只計算成功擊殺的情境）");
console.log("=".repeat(112));
console.log(w("克制關係", 18) + w("成功拆除數", 12) + w("最低投入", 10)
  + w("平均投入", 10) + w("平均拆除輪", 12) + w("平均攻方陣亡", 14) + "cannot_kill 數");
console.log("-".repeat(112));
for (const rel of ["攻方剋守方", "無克制", "守方反剋攻方"]) {
  const group = records.filter(item => item.rel === rel);
  const killed = group.filter(item => !item.cannotKill);
  const minInvest = new Map();
  for (const item of killed) {
    const key = `${item.defType}/${item.atkType}`;
    if (!minInvest.has(key) || item.investment < minInvest.get(key)) minInvest.set(key, item.investment);
  }
  const avg = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : "-";
  console.log(w(rel, 18) + w(`${killed.length}/${group.length}`, 12)
    + w(minInvest.size ? Math.min(...minInvest.values()) + " 顆" : "-", 10)
    + w(avg([...minInvest.values()]) + " 顆", 10)
    + w(avg(killed.map(item => item.defenderDeath)) + " 輪", 12)
    + w(avg(killed.map(item => item.atkDeaths)) + " 顆", 14)
    + group.filter(item => item.cannotKill).length);
}
console.log("");
console.log("=".repeat(112));
console.log("表 2  依克制關係彙總（乾淨拆除＝攻方零損失）");
console.log("=".repeat(112));
console.log(w("克制關係", 18) + w("配對數", 10) + w("1顆即殺", 12) + w("1顆乾淨殺", 14)
  + w("最低乾淨投入", 16) + w("該投入下拆除輪", 18) + "cannot_kill");
console.log("-".repeat(112));
const pairs = {};
for (const item of records) {
  const key = `${item.rel}|${item.defType}|${item.atkType}`;
  (pairs[key] = pairs[key] || []).push(item);
}
for (const rel of ["攻方剋守方", "無克制", "守方反剋攻方"]) {
  const keys = Object.keys(pairs).filter(k => k.startsWith(rel + "|"));
  let solo = 0, soloClean = 0, cannot = 0;
  const cleanInvest = [], cleanRound = [];
  for (const key of keys) {
    const group = pairs[key].sort((a, b) => a.investment - b.investment);
    const one = group[0];
    if (!one.cannotKill) solo++;
    if (!one.cannotKill && one.atkDeaths === 0) soloClean++;
    if (one.cannotKill) cannot++;
    const clean = group.find(item => !item.cannotKill && item.atkDeaths === 0);
    if (clean) { cleanInvest.push(clean.investment); cleanRound.push(clean.defenderDeath); }
  }
  const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";
  console.log(w(rel, 18) + w(keys.length, 10) + w(`${solo}/${keys.length}`, 12)
    + w(`${soloClean}/${keys.length}`, 14) + w(avg(cleanInvest) + " 顆", 16)
    + w(avg(cleanRound) + " 輪", 18) + cannot);
}
console.log("");
console.log("=".repeat(112));
console.log("附表  每個配對的最低乾淨拆除成本");
console.log("=".repeat(112));
console.log(w("守方", 8) + w("攻方", 8) + w("克制關係", 16) + w("最低乾淨投入", 16) + w("拆除輪", 10) + "1顆單挑結果");
console.log("-".repeat(112));
for (const key of Object.keys(pairs)) {
  const group = pairs[key].sort((a, b) => a.investment - b.investment);
  const clean = group.find(item => !item.cannotKill && item.atkDeaths === 0);
  const one = group[0];
  const soloText = one.cannotKill ? "cannot_kill" : one.atkDeaths ? `第${one.defenderDeath}輪同歸於盡` : `第${one.defenderDeath}輪乾淨殺`;
  console.log(w(NAME[group[0].defType], 8) + w(NAME[group[0].atkType], 8) + w(group[0].rel, 16)
    + w(clean ? clean.investment + " 顆" : "做不到", 16)
    + w(clean ? "第 " + clean.defenderDeath + " 輪" : "-", 10) + soloText);
}
