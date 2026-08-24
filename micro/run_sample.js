const { playGame } = require("./game_harness.js");
const GAMES = Number(process.argv[2] || 500);
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };

console.log("=".repeat(104));
console.log(`★★劍 斬入 —— 完整棋局小樣本（每組 ${GAMES} 局 × 先後手兩批 = ${GAMES * 2} 局）`);
console.log("二星＝HP×1.5 / ATK×1；★★★ 不存在；反震 33%；本測試不使用炮擊以隔離斬入影響");
console.log("=".repeat(104));
console.log(w("升星率", 10) + w("局長", 8) + w("★★劍出場", 12) + w("斬入次數", 12)
  + w("斬入/出場", 12) + w("形成3連", 10) + w("形成4連", 10) + w("形成5連", 10) + "斬入致勝");
console.log("-".repeat(104));

const rows = [];
for (const up of [0.25, 0.5, 0.75, 1.0]) {
  const t = { games: 0, rounds: 0, deployR2Sword: 0, cleaves: 0, formed3: 0, formed4: 0, formed5: 0,
    winByCleave: 0, broke3: 0, broke4: 0, diedSame: 0, diedNextRound: 0, delta: [], wins: 0, decided: 0 };
  for (let g = 0; g < GAMES; g++) for (const sp of [1, 2]) {
    const r = playGame(up, 1000003 * (g + 1) + sp, sp, 0.33);
    t.games++; t.rounds += r.rounds;
    if (r.gameOver && r.winner) t.decided++;
    for (const k of ["deployR2Sword", "cleaves", "formed3", "formed4", "formed5",
      "winByCleave", "broke3", "broke4", "diedSame", "diedNextRound"]) t[k] += r.stats[k];
    t.delta.push(...r.stats.maxLineDelta);
  }
  rows.push({ up, t });
  console.log(w(`${up * 100}%`, 10) + w((t.rounds / t.games).toFixed(1), 8)
    + w(t.deployR2Sword, 12) + w(t.cleaves, 12)
    + w(t.deployR2Sword ? (t.cleaves / t.deployR2Sword).toFixed(2) : "-", 12)
    + w(t.formed3, 10) + w(t.formed4, 10) + w(t.formed5, 10) + t.winByCleave);
}

console.log("");
console.log("=".repeat(104));
console.log("斬入的代價側");
console.log("=".repeat(104));
console.log(w("升星率", 10) + w("破壞自己3連", 14) + w("破壞自己4連", 14)
  + w("同輪死亡", 12) + w("下一輪死亡", 12) + w("最大連線差 平均", 18) + "斬入致勝佔全部勝局");
console.log("-".repeat(104));
for (const { up, t } of rows) {
  const avg = t.delta.length ? (t.delta.reduce((s, v) => s + v, 0) / t.delta.length).toFixed(2) : "-";
  const pos = t.delta.filter(v => v > 0).length, neg = t.delta.filter(v => v < 0).length;
  console.log(w(`${up * 100}%`, 10) + w(t.broke3, 14) + w(t.broke4, 14)
    + w(t.diedSame, 12) + w(t.diedNextRound, 12)
    + w(`${avg} (+${pos}/-${neg})`, 18)
    + (t.decided ? `${(t.winByCleave / t.decided * 100).toFixed(2)}%  (${t.winByCleave}/${t.decided})` : "-"));
}
