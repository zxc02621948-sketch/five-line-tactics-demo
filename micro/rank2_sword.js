const { setup, play, w, head, NAME } = require("./rank2_concept.js");

// 為了看清楚追擊打到誰，這裡自己跑迴圈並印出 trace
function detail(spec, label) {
  const e = setup(spec, 0.33);
  const before = new Set();
  for (const row of e.board) for (const u of row) if (u) before.add(u.id);
  const perTick = [];
  let ticks = 0;
  for (; ticks < 30; ticks++) {
    const t0 = e.trace.length;
    e.resolveCombat();
    perTick.push(e.trace.length - t0);
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
  const hits = e.trace.filter(t => t.kind === "harvest");
  console.log(w(label, 40) + w(`${ticks} 輪`, 7) + w(`${before.size - aliveIds.size} 顆`, 7)
    + w(`${hits.length} 次`, 7) + w(side[1].join(" ") || "全滅", 26) + w(side[2].join(" ") || "全滅", 30)
    + (hits.length ? `追擊→${hits.map(h => `(${h.to}) ${h.amount}`).join(" ")}` : "—"));
  return hits.length;
}

head("★★劍 追擊（新定義：檢查「被擊殺單位」的正交相鄰格）");
console.log(w("情境", 40) + w("輪數", 7) + w("死亡", 7) + w("追擊", 7) + w("守方剩餘", 26) + w("攻方剩餘", 30) + "追擊落點");
console.log("-".repeat(124));

// 核心 ★★劍 在 (4,4)，HP180 / ATK24。第 6 欄為初始 HP 覆寫。
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1]],
  "N1 單敵，死者旁無其他敵人（應 0）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1]],
  "N2 死者後方有敵人（劍打不到，新定義關鍵）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [3, 5, 2, "spear", 1]],
  "N3 死者側面有敵人（對劍是斜角）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1, 100], [3, 5, 2, "spear", 1, 60]],
  "N4 兩個候選，應打最低 HP 那個");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1, 20], [4, 7, 2, "spear", 1]],
  "N5 追擊直接殺死目標（測是否連鎖）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 6, 2, "shield", 1]],
  "N6 追擊目標是盾（劍不剋盾，無加成）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1], [4, 3, 2, "spear", 1], [4, 6, 2, "spear", 1]],
  "N7 劍被兩面夾（決鬥失效，還殺得掉嗎）");
detail([[4, 4, 1, "sword", 2], [4, 5, 2, "spear", 1, 20], [4, 3, 2, "spear", 1, 20], [4, 6, 2, "spear", 1], [4, 2, 2, "spear", 1]],
  "N8 同輪殺兩個（候選取聯集，仍只 1 次）");
detail([[4, 4, 1, "sword", 1], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1]],
  "N9 對照：★劍 同 N2 盤面");
detail([[4, 4, 1, "sword", 2], [3, 4, 1, "shield", 1], [4, 5, 2, "spear", 1], [4, 6, 2, "spear", 1]],
  "N10 有友軍盾護衛（實戰型）");
