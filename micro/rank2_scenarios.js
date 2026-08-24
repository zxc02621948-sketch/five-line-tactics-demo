const { setup, play, w, line, head, COUNTERED_BY, NAME } = require("./rank2_concept.js");
const C = [4, 4];
const run = (spec, ratio) => play(setup(spec, ratio));

// ---------- 1. ★★劍 收割 ----------
head("情境組 1  ★★劍 收割（核心在 (4,4)；ATK 24、HP 180）");
const swordCases = [
  ["單一敵人，無第二目標", [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1]]],
  ["兩敵一直線（收割有目標）", [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1]]],
  ["兩敵但只有一個相鄰", [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1]]],
  ["三面包圍", [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1], [3, 4, 2, "spear", 1]]],
  ["四面包圍", [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1], [3, 4, 2, "spear", 1], [5, 4, 2, "spear", 1]]],
  ["四面包圍但都是劍(無互剋)", [[4, 4, 1, "sword", 2], [4, 5, 2, "sword", 1], [4, 3, 2, "sword", 1], [3, 4, 2, "sword", 1], [5, 4, 2, "sword", 1]]],
];
for (const [label, spec] of swordCases) {
  const r = run(spec, 0.33);
  console.log(w(label, 34) + line(r) + "   每輪觸發:" + r.perTick.join(","));
}

// ---------- 2. ★★盾 反震 ----------
for (const ratio of [0.25, 0.33, 0.5]) {
  head(`情境組 2  ★★盾 反震 ${Math.round(ratio * 100)}%（HP 240、不主動攻擊）`);
  const shieldCases = [
    ["單人：1×★槍(剋盾)", [[4, 4, 1, "shield", 2], [4, 5, 2, "spear", 1]]],
    ["單人：1×★劍", [[4, 4, 1, "shield", 2], [4, 5, 2, "sword", 1]]],
    ["兩面：2×★槍", [[4, 4, 1, "shield", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1]]],
    ["三面：3×★槍", [[4, 4, 1, "shield", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1], [3, 4, 2, "spear", 1]]],
    ["四面：4×★槍", [[4, 4, 1, "shield", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1], [3, 4, 2, "spear", 1], [5, 4, 2, "spear", 1]]],
    ["護衛：盾+友軍劍被2槍打", [[4, 4, 1, "shield", 2], [4, 3, 1, "sword", 1], [4, 2, 2, "spear", 1], [3, 3, 2, "spear", 1]]],
  ];
  for (const [label, spec] of shieldCases) console.log(w(label, 34) + line(run(spec, ratio)));
}

// ---------- 3. ★★盾「不主動攻擊」的代價 ----------
head("情境組 3  ★★盾 不主動攻擊的代價（對照：同數值但會攻擊的一星盾群）");
console.log(w("★★盾(240,不攻擊,33%反震) vs 1槍", 34) + line(run([[4, 4, 1, "shield", 2], [4, 5, 2, "spear", 1]], 0.33)));
console.log(w("★盾(160,會攻擊) vs 1槍", 34) + line(run([[4, 4, 1, "shield", 1], [4, 5, 2, "spear", 1]], 0.33)));
console.log(w("★★盾 vs 1★劍(盾本應剋劍)", 34) + line(run([[4, 4, 1, "shield", 2], [4, 5, 2, "sword", 1]], 0.33)));
console.log(w("★盾 vs 1★劍(盾剋劍)", 34) + line(run([[4, 4, 1, "shield", 1], [4, 5, 2, "sword", 1]], 0.33)));

// ---------- 4. ★★槍 穿透 ----------
head("情境組 4  ★★槍 穿透（HP 180、ATK 24；總輸出上限＝ATK，因引擎仍分攤）");
const spearCases = [
  ["直線兩敵（穿透吃到 2 個）", [[4, 4, 1, "spear", 2], [4, 5, 2, "sword", 1], [4, 6, 2, "sword", 1]]],
  ["友軍擋在前，敵人在後", [[4, 4, 1, "spear", 2], [4, 5, 1, "sword", 1], [4, 6, 2, "sword", 1]]],
  ["四方向各兩敵（8 目標極限）", [[4, 4, 1, "spear", 2],
    [4, 5, 2, "sword", 1], [4, 6, 2, "sword", 1], [4, 3, 2, "sword", 1], [4, 2, 2, "sword", 1],
    [3, 4, 2, "sword", 1], [2, 4, 2, "sword", 1], [5, 4, 2, "sword", 1], [6, 4, 2, "sword", 1]]],
  ["四方向友軍牆+外圈敵人", [[4, 4, 1, "spear", 2],
    [4, 5, 1, "sword", 1], [4, 3, 1, "sword", 1], [3, 4, 1, "sword", 1], [5, 4, 1, "sword", 1],
    [4, 6, 2, "sword", 1], [4, 2, 2, "sword", 1], [2, 4, 2, "sword", 1], [6, 4, 2, "sword", 1]]],
  ["對照：★槍(無穿透) 直線兩敵", [[4, 4, 1, "spear", 1], [4, 5, 2, "sword", 1], [4, 6, 2, "sword", 1]]],
];
for (const [label, spec] of spearCases) console.log(w(label, 34) + line(run(spec, 0.33)));

// ---------- 5. 三種 ★★ 被正確克制 ----------
head("情境組 5  三種 ★★ 被正確克制兵種圍攻（1 / 2 / 3 隻）");
for (const core of ["sword", "shield", "spear"]) {
  const atk = COUNTERED_BY(core);
  for (const n of [1, 2, 3]) {
    const spec = [[4, 4, 1, core, 2]];
    const slots = [[4, 5], [4, 3], [3, 4], [5, 4]];
    for (let i = 0; i < n; i++) spec.push([slots[i][0], slots[i][1], 2, atk, 1]);
    console.log(w(`★★${NAME[core]} ← ${n}×★${NAME[atk]}`, 34) + line(run(spec, 0.33)));
  }
}
