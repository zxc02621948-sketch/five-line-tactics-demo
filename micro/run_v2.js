const { playGame, TYPE_LIST, TEST_DECK } = require("./game_harness.js");
const GAMES = Number(process.argv[2] || 400);
const RATES = [0, 0.25, 0.5, 0.75, 1.0];
const LBL = { 0: "0%", 0.25: "25%", 0.5: "50%", 0.75: "75%", 1: "100%" };
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const pct = v => (v * 100).toFixed(1) + "%";
const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";

function merge(into, from) {
  for (const t of TYPE_LIST) { into.r2ByType[t] += from.r2ByType[t]; into.blockedByUnique[t] += from.blockedByUnique[t]; }
  for (const k of ["eligibleChoseOne", "noDeployTurns", "turnSamples", "r2OnBoardSum", "r2Samples",
    "cleaves", "formed3", "formed4", "formed5", "cleaveWin", "broke3", "broke4",
    "diedSame", "diedNextCombat", "survivedNextCombat"]) into[k] += from[k];
  for (const k of [0, 1, 2]) into.lowAvail[k] += from.lowAvail[k];
  into.lowRuns.push(...from.lowRuns);
  into.r2DeathToReady.push(...from.r2DeathToReady);
  into.delta.push(...from.delta);
}
const blank = () => ({
  r2ByType: { sword: 0, shield: 0, spear: 0 }, blockedByUnique: { sword: 0, shield: 0, spear: 0 },
  eligibleChoseOne: 0, noDeployTurns: 0, turnSamples: 0, lowAvail: { 0: 0, 1: 0, 2: 0 }, lowRuns: [],
  r2OnBoardSum: 0, r2Samples: 0, r2DeathToReady: [], cleaves: 0, formed3: 0, formed4: 0,
  formed5: 0, cleaveWin: 0, broke3: 0, broke4: 0, diedSame: 0, diedNextCombat: 0,
  survivedNextCombat: 0, delta: [],
});

// 5x5 交叉矩陣，先後手分開
const M = {}, agg = {}, roundsOf = {};
for (const a of RATES) { M[a] = {}; agg[a] = blank(); roundsOf[a] = { sum: 0, n: 0 }; }
for (const a of RATES) for (const b of RATES) {
  const bucket = { 1: { win: 0, n: 0 }, 2: { win: 0, n: 0 } };
  for (let g = 0; g < GAMES; g++) for (const sp of [1, 2]) {
    const r = playGame(a, b, 1000003 * (g + 1) + sp * 7919 + Math.round(a * 100) * 31 + Math.round(b * 100), sp);
    bucket[sp].n++;
    if (r.winner === 1) bucket[sp].win++;
    merge(agg[a], r.S[0]); merge(agg[b], r.S[1]);
    roundsOf[a].sum += r.rounds; roundsOf[a].n++;
  }
  M[a][b] = {
    first: bucket[1].win / bucket[1].n,      // a 先手時 a 的勝率
    second: bucket[2].win / bucket[2].n,     // a 後手時 a 的勝率
    fair: (bucket[1].win / bucket[1].n + bucket[2].win / bucket[2].n) / 2,
  };
}

console.log("=".repeat(112));
console.log(`候選規則 v2：20 張牌庫（劍${TEST_DECK.sword}/盾${TEST_DECK.shield}/槍${TEST_DECK.spear}）＋ 每兵種場上唯一二星`);
console.log(`二星 HP×1.5 / ATK×1、斬入＋第二刀、盾不攻擊＋護衛50%＋反震33%、槍穿透、無炮擊、三星禁用`);
console.log(`每格 ${GAMES} 局 × 先後手兩批 = ${GAMES * 2} 局；SE ≈ ±${(50 / Math.sqrt(GAMES)).toFixed(1)}pt（單一 role）`);
console.log("=".repeat(112));

console.log("\n表 1  公平強度矩陣（列方先後手各半的勝率；對角線應 ≈ (100%-平手)/2）");
console.log("  " + w("列＼欄", 10) + RATES.map(r => w(LBL[r], 10)).join("") + "平均");
for (const a of RATES) {
  let s = 0;
  const cells = RATES.map(b => { s += M[a][b].fair; return w(pct(M[a][b].fair), 10); });
  console.log("  " + w(LBL[a], 10) + cells.join("") + pct(s / RATES.length));
}

console.log("\n表 2  相鄰級距（列方公平勝率 >50% = 更積極升星更強）");
for (const [a, b] of [[1, 0.75], [0.75, 0.5], [0.5, 0.25], [0.25, 0]]) {
  const f = M[a][b];
  console.log(`  ${w(LBL[a] + " vs " + LBL[b], 16)}公平 ${pct(f.fair)}   先手 ${pct(f.first)} / 後手 ${pct(f.second)}   ` +
    (f.fair > 0.52 ? "積極方勝" : f.fair < 0.48 ? "積極方敗" : "持平"));
}

console.log("\n" + "=".repeat(112));
console.log("表 3  二星產出與唯一限制");
console.log("=".repeat(112));
console.log("  " + w("升星率", 9) + w("局長", 7) + w("★★劍", 8) + w("★★盾", 8) + w("★★槍", 8)
  + w("每局★★總數", 13) + w("場上★★平均", 13) + w("被唯一限制擋下", 15) + "有資格但選一星");
for (const r of RATES) {
  const t = agg[r], games = roundsOf[r].n;
  const total = TYPE_LIST.reduce((s, k) => s + t.r2ByType[k], 0);
  const blocked = TYPE_LIST.reduce((s, k) => s + t.blockedByUnique[k], 0);
  console.log("  " + w(LBL[r], 9) + w((roundsOf[r].sum / games).toFixed(1), 7)
    + w(t.r2ByType.sword, 8) + w(t.r2ByType.shield, 8) + w(t.r2ByType.spear, 8)
    + w((total / games).toFixed(2), 13)
    + w((t.r2OnBoardSum / t.r2Samples).toFixed(2), 13)
    + w(`${blocked} (${(blocked / games).toFixed(2)}/局)`, 15)
    + `${t.eligibleChoseOne} (${(t.eligibleChoseOne / games).toFixed(2)}/局)`);
}

console.log("\n" + "=".repeat(112));
console.log("表 4  20 張牌庫的資源壓力");
console.log("=".repeat(112));
console.log("  " + w("升星率", 9) + w("可用=0", 11) + w("可用=1", 11) + w("可用<=2", 11)
  + w("低牌連續回合", 14) + w("完全無法部署", 14) + "★★死亡→該兵種再備妥");
for (const r of RATES) {
  const t = agg[r], obs = t.turnSamples * 3;   // 每次行動觀測 3 個兵種
  console.log("  " + w(LBL[r], 9)
    + w(`${t.lowAvail[0]} (${pct(t.lowAvail[0] / obs)})`, 11)
    + w(`${t.lowAvail[1]} (${pct(t.lowAvail[1] / obs)})`, 11)
    + w(pct((t.lowAvail[0] + t.lowAvail[1] + t.lowAvail[2]) / obs), 11)
    + w(`平均 ${avg(t.lowRuns)} 輪`, 14)
    + w(`${t.noDeployTurns} 次`, 14)
    + `平均 ${avg(t.r2DeathToReady)} 輪 (n=${t.r2DeathToReady.length})`);
}

console.log("\n" + "=".repeat(112));
console.log("表 5  ★★劍 斬入（instrumentation 已修正）");
console.log("=".repeat(112));
console.log("  " + w("升星率", 9) + w("斬入", 8) + w("斬入/出場", 11) + w("形成3連", 9)
  + w("形成4連", 9) + w("形成5連", 9) + w("斬入致勝", 10) + w("破壞自己3/4連", 14)
  + w("同輪死", 8) + w("下次結算死/活", 14) + "連線差平均");
for (const r of RATES) {
  const t = agg[r];
  console.log("  " + w(LBL[r], 9) + w(t.cleaves, 8)
    + w(t.r2ByType.sword ? (t.cleaves / t.r2ByType.sword).toFixed(2) : "-", 11)
    + w(t.formed3, 9) + w(t.formed4, 9) + w(t.formed5, 9) + w(t.cleaveWin, 10)
    + w(`${t.broke3} / ${t.broke4}`, 14) + w(t.diedSame, 8)
    + w(`${t.diedNextCombat} / ${t.survivedNextCombat}`, 14)
    + `${avg(t.delta)} (+${t.delta.filter(v => v > 0).length}/-${t.delta.filter(v => v < 0).length})`);
}
