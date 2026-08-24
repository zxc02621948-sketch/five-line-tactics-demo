const fs = require("fs"), path = require("path");
const HPS = [{ f: "hp3.json", l: "HP x3" }, { f: "hp2.5.json", l: "HP x2.5" }, { f: "hp2.json", l: "HP x2" }];
const S = ["up0", "up25", "up50", "up75", "up100"];
const NAME = { up0: "0%", up25: "25%", up50: "50%", up75: "75%", up100: "100%" };
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
const pad = (t, w) => String(t).padEnd(w);
const pct = v => v === null || v === undefined ? "  -  " : (v * 100).toFixed(1) + "%";

for (const hp of HPS) {
  const m = load(hp.f).matrix;
  console.log("\n" + "=".repeat(78));
  console.log(`【${hp.l} / ATK x2】升星率勝率矩陣  —— 表中數字＝列(先手方)的勝率`);
  console.log("=".repeat(78));
  for (const role of [["1", "列方先手"], ["2", "列方後手"]]) {
    console.log(`\n  ${role[1]}`);
    console.log("  " + pad("列\欄", 8) + S.map(s => pad(NAME[s], 9)).join("") + " 平均");
    for (const a of S) {
      let sum = 0;
      const cells = S.map(b => { const v = m[a][b].byStartingPlayer[role[0]].p1; sum += v; return pad(pct(v), 9); });
      console.log("  " + pad(NAME[a], 8) + cells.join("") + " " + pct(sum / S.length));
    }
  }
  console.log("\n  相鄰級距對決（列方先手 / 列方後手）");
  for (const [a, b] of [["up100", "up75"], ["up100", "up50"], ["up75", "up50"], ["up50", "up25"], ["up25", "up0"]]) {
    const first = m[a][b].byStartingPlayer["1"].p1, second = m[a][b].byStartingPlayer["2"].p1;
    const mark = first > 0.5 && second > 0.5 ? "積極方雙邊勝" : first > 0.5 || second > 0.5 ? "分歧" : "積極方雙邊敗";
    console.log(`    ${pad(NAME[a] + " vs " + NAME[b], 16)} ${pct(first)} / ${pct(second)}   ${mark}`);
  }
}

// 跨對局合併：每個升星率把它當 P1 的 5 個對局的原始計數加總
const agg = (m, style) => {
  const t = {};
  for (const b of S) {
    const raw = m[style][b].rank2Economy.p1.raw;
    for (const k of Object.keys(raw)) t[k] = (t[k] || 0) + raw[k];
  }
  return t;
};
const shape = (m, style) => {
  let rounds = 0, five = 0, draw = 0, first = 0, second = 0, n = 0;
  for (const b of S) {
    const c = m[style][b];
    rounds += c.rounds; five += c.fiveCompletionRate;
    draw += c.draw; first += c.byStartingPlayer["1"].p1; second += c.byStartingPlayer["2"].p1; n++;
  }
  return { rounds: rounds / n, five: five / n, draw: draw / n, first: first / n, second: second / n };
};

const ROWS = [
  ["每局★★數量", t => (t.count / t.samples).toFixed(2)],
  ["第1隻★★平均回合", t => t.firstRoundGames ? (t.firstRoundSum / t.firstRoundGames).toFixed(2) : "-"],
  ["第2隻★★平均回合", t => t.secondRoundGames ? (t.secondRoundSum / t.secondRoundGames).toFixed(2) : "-"],
  ["★★陣亡率", t => t.count ? pct(t.deaths / t.count) : "-"],
  ["★★平均死亡回合", t => t.deaths ? (t.deathRoundSum / t.deaths).toFixed(2) : "-"],
  ["★★陣亡者平均存活回合", t => t.deaths ? (t.survivalRounds / t.deaths).toFixed(2) : "-"],
  ["死亡前峰值圍攻方向數", t => t.deaths ? (t.peakDirsSum / t.deaths).toFixed(2) : "-"],
  ["一生被攻擊過的方向數", t => t.deaths ? (t.lifetimeDirsSum / t.deaths).toFixed(2) : "-"],
  ["陣亡者中被克制擊殺", t => t.deaths ? pct(t.killedByCounterMajority / t.deaths) : "-"],
  ["★全部★★中死於克制★", t => t.count ? pct(t.killedByCounterMajority / t.count) : "-"],
  ["合成後可用剩牌", t => t.craftSamples ? (t.remainingAfterCraft / t.craftSamples).toFixed(2) : "-"],
  ["合成後該兵種再部署次數", t => t.craftSamples ? (t.laterDeploys / t.craftSamples).toFixed(2) : "-"],
  ["兵種耗盡回合/局", t => (t.exhaustedTurns / t.samples).toFixed(2)],
];
for (const hp of HPS) {
  const m = load(hp.f).matrix;
  console.log("\n" + "=".repeat(78));
  console.log(`【${hp.l}】二星實戰狀態＋牌庫成本（依升星率，跨全部對手合併）`);
  console.log("=".repeat(78));
  console.log(pad("指標", 26) + S.map(s => pad(NAME[s], 10)).join(""));
  console.log("-".repeat(78));
  const totals = Object.fromEntries(S.map(s => [s, agg(m, s)]));
  for (const [label, fn] of ROWS) console.log(pad(label, 26) + S.map(s => pad(fn(totals[s]), 10)).join(""));
  console.log("\n" + pad("遊戲型態", 26) + S.map(s => pad(NAME[s], 10)).join(""));
  console.log("-".repeat(78));
  const shapes = Object.fromEntries(S.map(s => [s, shape(m, s)]));
  for (const [label, fn] of [["平均局長", v => v.rounds.toFixed(2)], ["五連完成率", v => pct(v.five)],
    ["非五連結束(平手)率", v => pct(v.draw)], ["該風格先手勝率", v => pct(v.first)], ["該風格後手勝率", v => pct(v.second)]]) {
    console.log(pad(label, 26) + S.map(s => pad(fn(shapes[s]), 10)).join(""));
  }
}
