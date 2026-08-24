// Alpha Core v1 候選版：先後手公平性測試（鏡像對）。
// 每組用同一個 gameSeed 跑兩局，只交換 startingPlayer。
// 因為兩位玩家的牌庫在建構子中就洗好（早於任何行動分歧），同一組的兩局牌組完全相同，
// 唯一差異就是誰先動 —— 這樣才能把「先手優勢」和「牌運/座位差異」分開。
const { GameEngine2, pickCell, pickType, TYPE_LIST, setSeed } = require("./game_harness.js");

const UP = 0.5;
const PAIRS = Number(process.argv[2] || 1000);
const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

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

function play(gameSeed, startingPlayer) {
  setSeed(gameSeed);
  const e = new GameEngine2({ turnOrderMode: "fixed", startingPlayer,
    randomInt: max => Math.floor(require("./game_harness.js").rnd() * max), reflectRatio: 0.33 });
  const first3 = [null, null], first4 = [null, null];
  const r2Made = [0, 0];
  let seen = 0, cleaveWin = false;

  for (let guard = 0; guard < 400 && !e.gameOver; guard++) {
    const pid = e.current, player = e.players[pid - 1];
    if (!player.hand.length) break;
    const cell = pickCell(e.board, pid);
    if (!cell) break;
    const type = pickType(e.board, player.hand, pid, cell);
    const have = player.hand.filter(t => t === type).length;
    let rank = 1;
    if (have >= 3 && require("./game_harness.js").rnd() < UP && !e.hasRank2(pid, type)) rank = 2;
    if (rank === 2) r2Made[pid - 1]++;
    const res = e.deploy(pid, { r: cell[0], c: cell[1], type, rank, turnId: e.turnId });
    if (!res.ok) e.deploy(pid, { r: cell[0], c: cell[1], type, rank: 1, turnId: e.turnId });

    for (const p of [1, 2]) {
      const run = maxRun(e.board, p);
      if (first3[p - 1] === null && run >= 3) first3[p - 1] = e.roundNo;
      if (first4[p - 1] === null && run >= 4) first4[p - 1] = e.roundNo;
    }
    for (; seen < e.cleaveLog.length; seen++) {
      const cl = e.cleaveLog[seen];
      if (cl.cleaveFormedFive && cl.fiveFinal && e.gameOver && e.winner === cl.pid) cleaveWin = true;
    }
  }
  let alive = [0, 0];
  for (const row of e.board) for (const u of row) if (u) alive[u.pid - 1]++;
  const deployed = e.roundRecords.reduce((s, r) => s + r.actions.filter(a => a.kind === "deploy").length, 0);
  const deaths = [0, 0];
  for (const l of e.logs) if (l.kind === "kill" && l.data && l.data.unit) deaths[l.data.unit.pid - 1]++;
  return { winner: e.winner, rounds: e.roundNo, first3, first4, r2Made, alive, deaths, cleaveWin, deployed };
}

// ---- 執行 ----
const S = {
  first: { w: 0, d: 0, l: 0 }, second: { w: 0, d: 0, l: 0 },
  rounds: 0, games: 0,
  f3: [[], []], f4: [[], []],           // [先手, 後手]
  r2: [0, 0], alive: [0, 0], deaths: [0, 0],
  fiveByCleave: 0, fiveByDeploy: 0,
  pair: { bothFirstMover: 0, bothSecondMover: 0, sameSeatP1: 0, sameSeatP2: 0, withDraw: 0 },
};
function record(res, starter) {
  S.games++; S.rounds += res.rounds;
  const other = 3 - starter;
  if (res.winner === starter) { S.first.w++; S.second.l++; }
  else if (res.winner === other) { S.first.l++; S.second.w++; }
  else { S.first.d++; S.second.d++; }
  for (const [idx, pid] of [[0, starter], [1, other]]) {
    if (res.first3[pid - 1] !== null) S.f3[idx].push(res.first3[pid - 1]);
    if (res.first4[pid - 1] !== null) S.f4[idx].push(res.first4[pid - 1]);
    S.r2[idx] += res.r2Made[pid - 1];
    S.alive[idx] += res.alive[pid - 1];
    S.deaths[idx] += res.deaths[pid - 1];
  }
  if (res.winner) { if (res.cleaveWin) S.fiveByCleave++; else S.fiveByDeploy++; }
}

for (let p = 0; p < PAIRS; p++) {
  const gs = 1000003 * (p + 1) + 7919;
  const g1 = play(gs, 1), g2 = play(gs, 2);
  record(g1, 1); record(g2, 2);
  if (!g1.winner || !g2.winner) S.pair.withDraw++;
  else if (g1.winner === 1 && g2.winner === 2) S.pair.bothFirstMover++;
  else if (g1.winner === 2 && g2.winner === 1) S.pair.bothSecondMover++;
  else if (g1.winner === 1 && g2.winner === 1) S.pair.sameSeatP1++;
  else if (g1.winner === 2 && g2.winner === 2) S.pair.sameSeatP2++;
}

const N = S.games;
const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const pc = v => (v * 100).toFixed(2) + "%";
const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";
const ms = s => (s.w + 0.5 * s.d) / N;
const se = s => {
  const W = s.w / N, D = s.d / N, m = W + 0.5 * D;
  return Math.sqrt((W + 0.25 * D - m * m) / N);
};

console.log("=".repeat(96));
console.log(`Alpha Core v1 候選版　先後手公平性（${PAIRS} 組鏡像對 = ${N} 局，雙方 upgradeChance = ${UP * 100}%）`);
console.log("同組兩局共用 gameSeed，牌組完全相同，只交換先手；AI 邏輯完全一致");
console.log("=".repeat(96));

console.log("\n【勝負】");
console.log("  " + w("身分", 10) + w("W", 8) + w("D", 8) + w("L", 8) + w("match score", 14) + w("SE", 9) + "95% CI");
for (const [name, s] of [["先手", S.first], ["後手", S.second]]) {
  const m = ms(s), e2 = se(s);
  console.log("  " + w(name, 10) + w(s.w, 8) + w(s.d, 8) + w(s.l, 8) + w(pc(m), 14)
    + w("±" + (e2 * 100).toFixed(2) + "pt", 9) + `[${pc(m - 1.96 * e2)}, ${pc(m + 1.96 * e2)}]`);
}
const z = (ms(S.first) - 0.5) / se(S.first);
console.log(`  z = ${z.toFixed(2)}　${Math.abs(z) >= 2.58 ? "p<0.01" : Math.abs(z) >= 1.96 ? "p<0.05" : Math.abs(z) >= 1.64 ? "p<0.10" : "未達顯著"}`);
console.log(`  平均局長 ${(S.rounds / N).toFixed(2)} 輪　平手率 ${pc(S.first.d / N)}`);

console.log("\n【節奏與資源：先手 vs 後手】");
console.log("  " + w("指標", 26) + w("先手", 12) + w("後手", 12) + "差（先手−後手）");
const rows = [
  ["第一次 3 連 平均回合", avg(S.f3[0]), avg(S.f3[1])],
  ["第一次 4 連 平均回合", avg(S.f4[0]), avg(S.f4[1])],
  ["每局 ★★ 產出", (S.r2[0] / N).toFixed(3), (S.r2[1] / N).toFixed(3)],
  ["終局場上存活棋數", (S.alive[0] / N).toFixed(3), (S.alive[1] / N).toFixed(3)],
  ["每局死亡棋數", (S.deaths[0] / N).toFixed(3), (S.deaths[1] / N).toFixed(3)],
];
for (const [label, a, b] of rows) {
  const d = (Number(a) - Number(b));
  console.log("  " + w(label, 26) + w(a, 12) + w(b, 12) + (d >= 0 ? "+" : "") + d.toFixed(3));
}
console.log(`  達成 3 連的局數：先手 ${S.f3[0].length} / 後手 ${S.f3[1].length}　`
  + `達成 4 連：先手 ${S.f4[0].length} / 後手 ${S.f4[1].length}`);

console.log("\n【最終五連的形成方式】");
const decided = S.fiveByCleave + S.fiveByDeploy;
console.log(`  正常部署形成 ${S.fiveByDeploy} (${pc(S.fiveByDeploy / decided)})　`
  + `戰鬥位移（斬入）形成 ${S.fiveByCleave} (${pc(S.fiveByCleave / decided)})`);

console.log("\n【鏡像對分類】（共 " + PAIRS + " 組）");
const P = S.pair;
console.log("  " + w("兩局都由先手方獲勝", 26) + w(P.bothFirstMover, 8) + pc(P.bothFirstMover / PAIRS) + "　← 純先手優勢");
console.log("  " + w("兩局都由後手方獲勝", 26) + w(P.bothSecondMover, 8) + pc(P.bothSecondMover / PAIRS));
console.log("  " + w("兩局都由 P1 座位獲勝", 26) + w(P.sameSeatP1, 8) + pc(P.sameSeatP1 / PAIRS) + "　← 牌運/座位差異");
console.log("  " + w("兩局都由 P2 座位獲勝", 26) + w(P.sameSeatP2, 8) + pc(P.sameSeatP2 / PAIRS) + "　← 牌運/座位差異");
console.log("  " + w("含平手的組", 26) + w(P.withDraw, 8) + pc(P.withDraw / PAIRS));
const seatSame = P.sameSeatP1 + P.sameSeatP2;
console.log(`\n  勝者跟著先手身分翻轉：${P.bothFirstMover} 組 (${pc(P.bothFirstMover / PAIRS)})`);
console.log(`  勝者跟著座位固定不翻轉：${seatSame} 組 (${pc(seatSame / PAIRS)})`);
