// 必要情境：斬入形成五連 → 第二刀打 ★★盾 → 反震殺死 ★★劍 → 最終 fiveLines 不成立
const { setup, NAME } = require("./rank2_concept.js");

function show(e, label) {
  const rows = [];
  for (let r = 3; r <= 5; r++) {
    rows.push("    " + [0,1,2,3,4,5].map(c => {
      const u = e.board[r][c];
      return u ? `P${u.pid}${"★".repeat(u.rank)}${NAME[u.type]}`.padEnd(8) : "·".padEnd(8);
    }).join(""));
  }
  console.log(`  ${label}\n${rows.join("\n")}`);
}

// 我方(P1) 已有 (4,0)~(4,3)；敵人 P2 殘血擋在 (4,4)；★★劍 在 (3,4)
// (4,5) 放 ★★盾，成為斬入後唯一相鄰敵人 → 吃第二刀 → 反震回打 ★★劍
// ★★劍 起始 HP 調到剛好會被反震打死
const REFLECT = 0.5;
for (const swordHp of [180, 20, 12]) {
  const e = setup([
    [3, 4, 1, "sword", 2, swordHp],
    [4, 0, 1, "sword", 1], [4, 1, 1, "sword", 1], [4, 2, 1, "sword", 1], [4, 3, 1, "sword", 1],
    [4, 4, 2, "spear", 1, 20],
    [4, 5, 2, "shield", 2],
  ], REFLECT);
  console.log("\n" + "=".repeat(88));
  console.log(`★★劍 起始 HP = ${swordHp}　反震比例 ${REFLECT * 100}%`);
  console.log("=".repeat(88));
  console.log(`  結算前 fiveLines(P1) = ${e.fiveLines(1).length}`);
  show(e, "結算前 (列 3~5 / 行 0~5)");
  e.resolveCombat();
  const cl = e.cleaveLog[0];
  console.log(`  斬入: ${cl ? `(${cl.from}) → (${cl.to})　斬入當下 fiveLines = ${cl.fiveAfterCleave ? 1 : 0}` : "未觸發"}`);
  console.log(`  第二刀: ${cl && cl.hit ? `(${cl.hit.to}) ${cl.hit.amount} 對${NAME[cl.hit.targetType]}` : "無"}`);
  const reflects = e.trace.filter(t => t.kind === "reflect");
  console.log(`  反震: ${reflects.length ? reflects.map(t => `→(${t.to}) ${t.amount}`).join(" ") : "無"}`);
  const swordAlive = [...e.board.flat()].some(u => u && u.pid === 1 && u.rank === 2);
  console.log(`  ★★劍 最終狀態: ${swordAlive ? "存活" : "陣亡"}`);
  show(e, "結算後");
  const five = e.fiveLines(1).length;
  console.log(`  ★ 最終 fiveLines(P1) = ${five} → ${five ? "P1 獲勝" : "五連不成立，未獲勝"}`);
}
