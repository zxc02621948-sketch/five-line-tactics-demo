// 從已跑完的公平強度矩陣反推 W/D/L 與 match score。不重跑。
const F = {   // F[a][b] = a 對 b 的公平勝率（先後手各半），取自上一輪輸出
  0:    { 0: .459, 25: .425, 50: .375, 75: .368, 100: .349 },
  25:   { 0: .515, 25: .461, 50: .443, 75: .399, 100: .403 },
  50:   { 0: .559, 25: .512, 50: .464, 75: .445, 100: .420 },
  75:   { 0: .601, 25: .541, 50: .504, 75: .456, 100: .464 },
  100:  { 0: .630, 25: .553, 50: .520, 75: .514, 100: .451 },
};
const N = 800;                       // 每格 400 局 × 先後手兩批
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const p = v => (v * 100).toFixed(2) + "%";

function score(a, b) {
  const win = F[a][b], loss = F[b][a];
  const draw = 1 - win - loss;
  const ms = win + 0.5 * draw;
  const varX = (win + 0.25 * draw) - ms * ms;      // X ∈ {1, .5, 0}
  const se = Math.sqrt(varX / N);
  return { win, draw, loss, ms, se, z: (ms - 0.5) / se, lo: ms - 1.96 * se, hi: ms + 1.96 * se };
}
const pv = z => { const x = Math.abs(z); return 2 * (1 - (1 - 0.5 * Math.exp(-0.717 * x - 0.416 * x * x))); };

console.log("=".repeat(112));
console.log("match score = Win + 0.5×Draw　（draw 由 1 − F(a,b) − F(b,a) 反推，n = 800/格）");
console.log("=".repeat(112));
console.log("  " + w("對局", 16) + w("Win", 9) + w("Draw", 9) + w("Loss", 9)
  + w("match score", 13) + w("SE", 8) + w("95% CI", 18) + w("z", 8) + "顯著性");
console.log("-".repeat(112));
for (const [a, b] of [[25, 0], [50, 25], [75, 50], [100, 75], [100, 0]]) {
  const s = score(a, b);
  const sig = Math.abs(s.z) >= 2.58 ? "p<0.01 ★★" : Math.abs(s.z) >= 1.96 ? "p<0.05 ★" : Math.abs(s.z) >= 1.64 ? "p<0.10 (邊際)" : "未達顯著";
  console.log("  " + w(`${a}% vs ${b}%`, 16) + w(p(s.win), 9) + w(p(s.draw), 9) + w(p(s.loss), 9)
    + w(p(s.ms), 13) + w("±" + (s.se * 100).toFixed(2) + "pt", 8)
    + w(`[${p(s.lo)}, ${p(s.hi)}]`, 18) + w(s.z.toFixed(2), 8) + sig);
}

console.log("\n累積一致性檢查（各階「高於均勢」的幅度應可疊加）");
let sum = 0;
for (const [a, b] of [[25, 0], [50, 25], [75, 50], [100, 75]]) {
  const d = (score(a, b).ms - 0.5) * 100; sum += d;
  console.log(`  ${w(a + "% vs " + b + "%", 16)}+${d.toFixed(2)}pt`);
}
console.log(`  ${w("四階加總", 16)}+${sum.toFixed(2)}pt`);
console.log(`  ${w("100% vs 0% 實測", 16)}+${((score(100, 0).ms - 0.5) * 100).toFixed(2)}pt`);

console.log("\n對角線（同策略互打）：");
for (const r of [0, 25, 50, 75, 100]) {
  const s = score(r, r);
  console.log(`  ${w(r + "%", 8)}Win ${p(s.win)}  Draw ${p(s.draw)}  match score ${p(s.ms)}`);
}
