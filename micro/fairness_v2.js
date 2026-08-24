// 先後手公平性 v2：顯式驅動 P1 → P2 → 完整結算 → 同時判勝。
// 不修改 game_engine.js，不調整任何兵種數值、AI 權重、牌庫、二星規則。
//
// 與 v1 的差異只有三處，全部在測試側：
//   1. 由本檔自己控制回合流程，並用執行期斷言確認「單方部署後不會發生戰鬥或判勝」
//   2. 獨立實作五連檢查，與引擎的判定交叉驗證
//   3. bothFive 與 unfinished 分開統計；首次 3/4 連改在戰鬥結算後才量（存活線）
const H = require("./game_harness.js");
const { GameEngine2, pickCell, pickType, setSeed, rnd } = H;

const UP = 0.5;
const PAIRS = Number(process.argv[2] || 1000);
const ROUND_CAP = 200;
const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

// 獨立的最長連線與五連判定，用來交叉驗證引擎
function maxRun(board, pid) {
  let best = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (!board[r][c] || board[r][c].pid !== pid) continue;
    for (const [dr, dc] of LINE_DIRS) {
      let n = 0;
      for (let rr = r, cc = c; inB(rr, cc) && board[rr][cc] && board[rr][cc].pid === pid; rr += dr, cc += dc) n++;
      if (n > best) best = n;
    }
  }
  return best;
}
const hasFive = (board, pid) => maxRun(board, pid) >= 5;

const AUDIT = { earlyCombat: 0, earlyGameOver: 0, verdictMismatch: 0, combatPerRoundBad: 0 };

function play(gameSeed, startingPlayer) {
  setSeed(gameSeed);
  const e = new GameEngine2({ turnOrderMode: "fixed", startingPlayer,
    randomInt: max => Math.floor(rnd() * max), reflectRatio: 0.33 });

  const first3 = [null, null], first4 = [null, null];
  let outcome = null, rounds = 0;

  for (let round = 1; round <= ROUND_CAP; round++) {
    const combatBefore = e.combatResolutionCount;

    // ---- 兩次部署：P1(先手) → P2(後手) ----
    let aborted = false;
    for (let slot = 0; slot < 2; slot++) {
      const pid = e.current, player = e.players[pid - 1];
      if (!player.hand.length) { aborted = true; break; }
      const cell = pickCell(e.board, pid);
      if (!cell) { aborted = true; break; }
      const type = pickType(e.board, player.hand, pid, cell);
      const have = player.hand.filter(t => t === type).length;
      let rank = 1;
      if (have >= 3 && rnd() < UP && !e.hasRank2(pid, type)) rank = 2;
      const res = e.deploy(pid, { r: cell[0], c: cell[1], type, rank, turnId: e.turnId });
      if (!res.ok) {
        const fb = e.deploy(pid, { r: cell[0], c: cell[1], type, rank: 1, turnId: e.turnId });
        if (!fb.ok) { aborted = true; break; }
      }
      // 斷言：第一位部署完，不得發生戰鬥、也不得判勝
      if (slot === 0) {
        if (e.combatResolutionCount !== combatBefore) AUDIT.earlyCombat++;
        if (e.gameOver) AUDIT.earlyGameOver++;
      }
    }
    if (aborted) { outcome = "unfinished"; rounds = round; break; }

    // ---- 本輪應恰好結算一次完整戰鬥（含技能／斬入／第二刀／護衛／反震／死亡清除）----
    if (e.combatResolutionCount !== combatBefore + 1) AUDIT.combatPerRoundBad++;

    // ---- 戰鬥後才量存活連線 ----
    for (const p of [1, 2]) {
      const run = maxRun(e.board, p);
      if (first3[p - 1] === null && run >= 3) first3[p - 1] = round;
      if (first4[p - 1] === null && run >= 4) first4[p - 1] = round;
    }

    // ---- 同時檢查雙方最終存活盤面的五連 ----
    const f1 = hasFive(e.board, 1), f2 = hasFive(e.board, 2);
    const mine = f1 && f2 ? "bothFive" : f1 ? "p1" : f2 ? "p2" : null;
    const engineVerdict = !e.gameOver ? null
      : e.winner === "draw" ? "bothFive" : e.winner === 1 ? "p1" : "p2";
    if (mine !== engineVerdict) AUDIT.verdictMismatch++;
    if (mine) { outcome = mine; rounds = round; break; }
    rounds = round;
  }
  if (!outcome) outcome = "unfinished";
  return { outcome, rounds, first3, first4 };
}

// ---------------- 執行 ----------------
const S = {
  games: 0, rounds: 0,
  firstW: 0, firstL: 0, bothFive: 0, unfinished: 0,
  f3: [[], []], f4: [[], []],
  pair: { bothFirst: 0, bothSecond: 0, splitOne: 0, withNonDecisive: 0 },
};
for (let p = 0; p < PAIRS; p++) {
  const gs = 1000003 * (p + 1) + 7919;
  const g1 = play(gs, 1), g2 = play(gs, 2);
  for (const [g, starter] of [[g1, 1], [g2, 2]]) {
    S.games++; S.rounds += g.rounds;
    const other = 3 - starter;
    if (g.outcome === `p${starter}`) S.firstW++;
    else if (g.outcome === `p${other}`) S.firstL++;
    else if (g.outcome === "bothFive") S.bothFive++;
    else S.unfinished++;
    for (const [idx, pid] of [[0, starter], [1, other]]) {
      if (g.first3[pid - 1] !== null) S.f3[idx].push(g.first3[pid - 1]);
      if (g.first4[pid - 1] !== null) S.f4[idx].push(g.first4[pid - 1]);
    }
  }
  const d1 = g1.outcome === "p1" ? "first" : g1.outcome === "p2" ? "second" : null;
  const d2 = g2.outcome === "p2" ? "first" : g2.outcome === "p1" ? "second" : null;
  if (!d1 || !d2) S.pair.withNonDecisive++;
  else if (d1 === "first" && d2 === "first") S.pair.bothFirst++;
  else if (d1 === "second" && d2 === "second") S.pair.bothSecond++;
  else S.pair.splitOne++;
}

const N = S.games;
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const pc = v => (v * 100).toFixed(2) + "%";
const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";

const D = S.bothFive + S.unfinished;
const W = S.firstW / N, DR = D / N;
const ms = W + 0.5 * DR;
const se = Math.sqrt((W + 0.25 * DR - ms * ms) / N);
const z = (ms - 0.5) / se;

console.log("=".repeat(96));
console.log(`先後手公平性 v2　${PAIRS} 組鏡像對 = ${N} 局　固定 P1→P2→結算　upgradeChane ${UP * 100}%`);
console.log("=".repeat(96));

console.log("\n【流程稽核】（0 表示流程如預期）");
console.log(`  單方部署後就發生戰鬥： ${AUDIT.earlyCombat}`);
console.log(`  單方部署後就判勝：     ${AUDIT.earlyGameOver}`);
console.log(`  每輪戰鬥次數不等於 1： ${AUDIT.combatPerRoundBad}`);
console.log(`  獨立判定與引擎不一致： ${AUDIT.verdictMismatch}`);

console.log("\n【先手勝負】");
console.log("  " + w("W", 8) + w("L", 8) + w("bothFive", 11) + w("unfinished", 12)
  + w("match score", 14) + w("SE", 9) + "95% CI");
console.log("  " + w(S.firstW, 8) + w(S.firstL, 8) + w(S.bothFive, 11) + w(S.unfinished, 12)
  + w(pc(ms), 14) + w("±" + (se * 100).toFixed(2) + "pt", 9)
  + `[${pc(ms - 1.96 * se)}, ${pc(ms + 1.96 * se)}]`);
console.log(`  z = ${z.toFixed(2)}　${Math.abs(z) >= 2.58 ? "p<0.01" : Math.abs(z) >= 1.96 ? "p<0.05" : "未達顯著"}`);
console.log(`  bothFive 比例 ${pc(S.bothFive / N)}　unfinished 比例 ${pc(S.unfinished / N)}`);
console.log(`  平均回合數 ${(S.rounds / N).toFixed(2)}`);

console.log("\n【首次形成存活連線（戰鬥結算後量測）】");
console.log("  " + w("", 12) + w("先手", 10) + w("後手", 10) + "差");
console.log("  " + w("首次 3 連", 12) + w(avg(S.f3[0]), 10) + w(avg(S.f3[1]), 10)
  + (Number(avg(S.f3[0])) - Number(avg(S.f3[1]))).toFixed(2));
console.log("  " + w("首次 4 連", 12) + w(avg(S.f4[0]), 10) + w(avg(S.f4[1]), 10)
  + (Number(avg(S.f4[0])) - Number(avg(S.f4[1]))).toFixed(2));
console.log(`  達成 3 連局數 先手 ${S.f3[0].length} / 後手 ${S.f3[1].length}　`
  + `達成 4 連 先手 ${S.f4[0].length} / 後手 ${S.f4[1].length}`);

console.log("\n【鏡像對分類】（共 " + PAIRS + " 組）");
console.log("  " + w("兩局都是先手勝", 20) + w(S.pair.bothFirst, 8) + pc(S.pair.bothFirst / PAIRS));
console.log("  " + w("兩局都是後手勝", 20) + w(S.pair.bothSecond, 8) + pc(S.pair.bothSecond / PAIRS));
console.log("  " + w("各勝一局", 20) + w(S.pair.splitOne, 8) + pc(S.pair.splitOne / PAIRS));
console.log("  " + w("含非決勝局", 20) + w(S.pair.withNonDecisive, 8) + pc(S.pair.withNonDecisive / PAIRS));
