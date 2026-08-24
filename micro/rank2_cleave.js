const { setup, NAME } = require("./rank2_concept.js");
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605→]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };

function scenario(label, spec, maxTicks = 6) {
  const e = setup(spec, 0.33);
  const before = new Set();
  for (const row of e.board) for (const u of row) if (u) before.add(u.id);
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    e.resolveCombat();
    const alive = { 1: 0, 2: 0 };
    for (const row of e.board) for (const u of row) if (u) alive[u.pid]++;
    if (!alive[1] || !alive[2]) { ticks++; break; }
  }
  const side = { 1: [], 2: [] };
  const aliveIds = new Set();
  for (const row of e.board) for (const u of row) if (u) {
    aliveIds.add(u.id);
    side[u.pid].push(`${"★".repeat(u.rank)}${NAME[u.type]}${Math.max(0, u.hp)}`);
  }
  const cl = e.cleaveLog;
  console.log("\n" + label);
  console.log("  " + w(`${ticks} 輪`, 8) + w(`死亡 ${before.size - aliveIds.size}`, 9)
    + w(`斬入 ${cl.length} 次`, 11) + w("我方: " + (side[1].join(" ") || "全滅"), 34)
    + "敵方: " + (side[2].join(" ") || "全滅"));
  if (!cl.length) { console.log("  （未觸發斬入）"); return; }
  for (const c of cl) {
    const destroyed = c.beforeRunAtOld >= 3 && c.afterMax < c.beforeMax;
    console.log(`  座標 (${c.from}) → (${c.to})`);
    console.log(`  己方最大連線 ${c.beforeMax} → ${c.afterMax}` +
      `　原位連線長 ${c.beforeRunAtOld}　新位連線長 ${c.afterRunAtNew}`);
    console.log(`  破壞原本3/4連: ${destroyed ? "是" : "否"}` +
      `　新形成: ${c.afterRunAtNew >= 5 ? "五連" : c.afterRunAtNew >= 4 ? "四連" : c.afterRunAtNew >= 3 ? "三連" : "無"}` +
      `　斬入直接勝利: ${c.win ? "★ 是 ★" : "否"}`);
    console.log(`  斬入後周圍敵人數: ${c.foesAfter}　第二刀: ` +
      (c.hit ? `(${c.hit.to}) ${c.hit.amount} 對${NAME[c.hit.targetType]}` : "無（僅位移，未產生額外傷害）"));
  }
}

console.log("=".repeat(100));
console.log("★★劍 斬入／收割 —— deterministic 盤面測試（P1＝我方，★★劍 HP180/ATK24）");
console.log("=".repeat(100));

// A. 斬入後改善己方連線：填補自己線上的缺口
scenario("A1  我方 (4,1)(4,2)(4,4)，敵人卡在缺口 (4,3)，劍從 (3,3) 斬入",
  [[3, 3, 1, "sword", 2], [4, 1, 1, "sword", 1], [4, 2, 1, "sword", 1], [4, 4, 1, "sword", 1],
   [4, 3, 2, "spear", 1, 20]]);

scenario("A2  我方 (4,2)(4,3)，敵人在 (4,4)，劍從 (3,4) 斬入延伸成三連",
  [[3, 4, 1, "sword", 2], [4, 2, 1, "sword", 1], [4, 3, 1, "sword", 1],
   [4, 4, 2, "spear", 1, 20]]);

// B. 斬入後破壞自己的連線
scenario("B1  ★★劍 是我方三連的末端 (4,4)，殺 (4,5) 後被迫離開",
  [[4, 2, 1, "sword", 1], [4, 3, 1, "sword", 1], [4, 4, 1, "sword", 2],
   [4, 5, 2, "spear", 1, 20]]);

scenario("B2  ★★劍 是我方四連的中間 (4,3)，殺 (3,3) 後留下缺口",
  [[4, 1, 1, "sword", 1], [4, 2, 1, "sword", 1], [4, 3, 1, "sword", 2], [4, 4, 1, "sword", 1],
   [3, 3, 2, "spear", 1, 20]]);

// C. 斬入後直接形成五連
scenario("C1  我方 (4,0)(4,1)(4,2)(4,3)，敵人擋在 (4,4)，劍從 (3,4) 斬入補成五連",
  [[3, 4, 1, "sword", 2], [4, 0, 1, "sword", 1], [4, 1, 1, "sword", 1], [4, 2, 1, "sword", 1], [4, 3, 1, "sword", 1],
   [4, 4, 2, "spear", 1, 20]]);

// D. 斬入敵陣後暴露自己
scenario("D1  斬入前只貼 1 敵（決鬥成立），斬入後被 3 敵包圍",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20],
   [4, 6, 2, "spear", 1], [3, 5, 2, "spear", 1], [5, 5, 2, "spear", 1]]);

scenario("D2  斬入後被 4 敵包圍（最大暴露）",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20],
   [4, 6, 2, "spear", 1], [3, 5, 2, "spear", 1], [5, 5, 2, "spear", 1], [4, 4, 2, "spear", 1, 999]].slice(0, 5)
   .concat([[3, 5, 2, "spear", 1]]).filter((v, i, a) => a.findIndex(x => x[0] === v[0] && x[1] === v[1]) === i));

// E. 斬入後第二刀
scenario("E1  新位置只有 1 個敵人",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20], [4, 6, 2, "spear", 1]]);

scenario("E2  新位置 2 個敵人，HP 100 / 60 → 應打 60",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20], [4, 6, 2, "spear", 1, 100], [3, 5, 2, "spear", 1, 60]]);

scenario("E3  第二刀目標是盾（劍不剋盾，應為 24 不是 30）",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20], [4, 6, 2, "shield", 1]]);

scenario("E4  第二刀直接殺死目標，其後方還有敵人（測連鎖）",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20], [4, 6, 2, "spear", 1, 20], [4, 7, 2, "spear", 1]]);

// F. 斬入後沒有第二目標
scenario("F1  殺掉孤立敵人，新位置無敵人 → 只位移",
  [[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20]]);

// G. 擊殺但 ★★劍 同輪也死亡
scenario("G1  ★★劍 殘血 10，與敵人同輪互殺",
  [[4, 4, 1, "sword", 2, 10], [4, 5, 2, "spear", 1, 20], [4, 6, 2, "spear", 1]]);
