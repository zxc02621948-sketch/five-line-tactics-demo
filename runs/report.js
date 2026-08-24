const fs = require("fs");
const path = require("path");
const SETTINGS = [
  { tag: "hp3_atk2", label: "HP x3 / ATK x2 (現行)" },
  { tag: "hp2.5_atk1.6", label: "HP x2.5 / ATK x1.6" },
  { tag: "hp2.25_atk1.5", label: "HP x2.25 / ATK x1.5" },
];
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
const pct = value => value === null || value === undefined ? "  -  " : (value * 100).toFixed(1) + "%";
const pad = (text, width) => String(text).padEnd(width);

// matrix.ranker.<opp> 裡，P1 = ranker。byStartingPlayer['1'] = ranker 先手那批。
const view = (file, opp) => {
  const cell = load(file).matrix.ranker[opp];
  return {
    first: cell.byStartingPlayer["1"].p1,
    second: cell.byStartingPlayer["2"].p1,
    games: cell.byStartingPlayer["1"].games + cell.byStartingPlayer["2"].games,
    economy: cell.rank2Economy.p1,
    typeMix: cell.typeMix,
    rounds: cell.rounds,
  };
};

console.log("=".repeat(96));
console.log("表 1  ranker 勝率：vs balanced 對照 vs counter（每格 2000 局，固定先手模式）");
console.log("=".repeat(96));
console.log(pad("二星倍率", 24) + pad("對手", 22) + pad("ranker先手", 12) + pad("ranker後手", 12) + "局數");
console.log("-".repeat(96));
const summary = [];
for (const setting of SETTINGS) {
  const balanced = view(`${setting.tag}_balanced.json`, "balanced");
  const counter = view(`${setting.tag}_counter.json`, "counter");
  const control = view(`${setting.tag}_control.json`, "counter");
  summary.push({ setting, balanced, counter, control });
  const rows = [["balanced", balanced], ["counter", counter], ["counter(權重歸零對照)", control]];
  for (const [name, data] of rows) {
    console.log(pad(name === "balanced" ? setting.label : "", 24) + pad(name, 22)
      + pad(pct(data.first), 12) + pad(pct(data.second), 12) + data.games);
  }
  console.log("-".repeat(96));
}

console.log();
console.log("=".repeat(96));
console.log("表 2  勝率差（正值＝該對手比不上另一個，也就是壓不住 ranker）");
console.log("=".repeat(96));
console.log(pad("二星倍率", 24) + pad("先手差", 26) + "後手差");
console.log("-".repeat(96));
for (const { setting, balanced, counter, control } of summary) {
  const dFirst = (counter.first - balanced.first) * 100;
  const dSecond = (counter.second - balanced.second) * 100;
  const cFirst = (counter.first - control.first) * 100;
  const cSecond = (counter.second - control.second) * 100;
  console.log(pad(setting.label, 24)
    + pad(`counter−balanced ${dFirst >= 0 ? "+" : ""}${dFirst.toFixed(1)}pt`, 26)
    + `${dSecond >= 0 ? "+" : ""}${dSecond.toFixed(1)}pt`);
  console.log(pad("", 24)
    + pad(`counter−對照組   ${cFirst >= 0 ? "+" : ""}${cFirst.toFixed(1)}pt`, 26)
    + `${cSecond >= 0 ? "+" : ""}${cSecond.toFixed(1)}pt`);
}

console.log();
console.log("=".repeat(96));
console.log("表 3  ranker 的二星經濟（對手＝counter）");
console.log("=".repeat(96));
const FIELDS = [
  ["rank2PerGame", "每局★★數量"],
  ["avgFirstRank2Round", "第1隻★★出現回合"],
  ["avgSecondRank2Round", "第2隻★★出現回合"],
  ["secondRank2GameRate", "有做出第2隻的局數比例"],
  ["avgUsableCardsLeftAfterCraft", "合成後該兵種可用剩牌"],
  ["avgLaterDeploysOfCraftedType", "該兵種後續部署次數"],
  ["exhaustedTurnsPerGame", "該兵種耗盡回合/局"],
  ["avgSurvivalRoundsOfDead", "★★陣亡者平均存活回合"],
  ["rank2DeathRate", "★★陣亡率"],
  ["killedByCounterRate", "被克制兵種擊殺比例"],
  ["avgCounterDamageShare", "陣亡★★所受傷害中克制兵種佔比"],
];
console.log(pad("指標", 34) + SETTINGS.map(s => pad(s.label.split(" (")[0], 21)).join(""));
console.log("-".repeat(96));
for (const [key, label] of FIELDS) {
  const isRate = ["secondRank2GameRate", "rank2DeathRate", "killedByCounterRate", "avgCounterDamageShare"].includes(key);
  console.log(pad(label, 34) + summary.map(item => {
    const value = item.counter.economy[key];
    return pad(value === null ? "-" : isRate ? pct(value) : value, 21);
  }).join(""));
}
console.log();
console.log("平均局長（回合）: " + summary.map(item => `${item.setting.label.split(" (")[0]}=${item.counter.rounds}`).join("  "));
console.log("counter 選型分佈  : " + JSON.stringify(summary[0].counter.typeMix.p2));
console.log("ranker  選型分佈  : " + JSON.stringify(summary[0].counter.typeMix.p1));
