// 精準測「做出 ★★T 之後那幾輪，想放 T 卻放不出來」——局部效應，不看總平均。
const { GameEngine, ALPHA_TURN_ORDER, TYPES } = require("../game_engine.js");
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const TYPE_LIST = ["sword", "shield", "spear"];
const N = 9;
function makeRng(seed) { let s = seed >>> 0;
  return (max) => { s = (s * 1664525 + 1013904223) >>> 0; return Math.floor((s / 4294967296) * max); }; }
const inB = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

function cellScore(board, r, c, pid) {
  if (board[r][c]) return -1;
  let score = 0;
  for (const [dr, dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    for (const owner of [pid, pid === 1 ? 2 : 1]) {
      let run = 0, open = 0;
      for (const sign of [1, -1]) { let k = 1;
        while (k < 5) { const nr = r + dr*k*sign, nc = c + dc*k*sign;
          if (!inB(nr, nc) || !board[nr][nc] || board[nr][nc].pid !== owner) {
            if (inB(nr, nc) && !board[nr][nc]) open++; break; }
          run++; k++; } }
      if (run >= 1) score += (owner === pid ? 1 : 0.9) * (run*run) * (open ? 1 : 0.4);
    } }
  return score + 0.01*(4-Math.abs(r-4)) + 0.01*(4-Math.abs(c-4));
}
function wantedTypeAt(board, r, c, pid) {
  const tally = {};
  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    for (let k = 1; k <= 2; k++) {
      const nr = r+dr*k, nc = c+dc*k;
      if (!inB(nr, nc)) break;
      const u = board[nr][nc]; if (!u) continue;
      if (u.pid !== pid) { const want = TYPE_LIST.find(t => COUNTER[t] === u.type);
        tally[want] = (tally[want] || 0) + (u.rank === 2 ? 3 : 1) / k; }
      break; } }
  const e = Object.entries(tally).sort((a,b) => b[1]-a[1]);
  return e.length ? e[0][0] : null;
}
const eliteOn = (board, pid, type) => board.some(row => row.some(u =>
  u && u.pid === pid && u.type === type && u.rank === 2));

const WINDOW = 4;   // 做完 ★★ 後追蹤 4 輪
function playGame(seed, upgradeRate, S) {
  const rnd = makeRng(seed);
  const engine = new GameEngine({ roomCode: "CW", ...ALPHA_TURN_ORDER, randomInt: rnd });
  const eliteAt = { 1: {}, 2: {} };      // pid -> type -> 做出的輪次
  let guard = 0;
  while (!engine.gameOver && guard++ < 400) {
    const pid = engine.current, player = engine.players[pid-1], hand = player.hand;
    if (!hand.length || !engine.hasEmptyCell()) break;
    let best = null, bs = -Infinity;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const s = cellScore(engine.board, r, c, pid);
      if (s > bs) { bs = s; best = [r, c]; } }
    const [r, c] = best;

    const want = wantedTypeAt(engine.board, r, c, pid);
    if (want) {
      const have = hand.includes(want);
      const madeAt = eliteAt[pid][want];
      // 分三桶：剛做完該兵種★★的窗口內 / 做過但已過窗口 / 從沒做過該兵種
      const bucket = madeAt === undefined ? S.never
        : (engine.roundNo - madeAt <= WINDOW ? S.inWindow : S.afterWindow);
      bucket.wants++; if (!have) bucket.starved++;
      // 手牌多樣性（有幾種兵種）
      S.diversity[madeAt === undefined ? "never" : "made"].push(new Set(hand).size);
    }
    let type = want && hand.includes(want) ? want
      : TYPE_LIST.filter(t => hand.includes(t))
          .sort((a,b) => hand.filter(x=>x===b).length - hand.filter(x=>x===a).length)[0];
    let rank = 1;
    const cand = TYPE_LIST.filter(t => hand.filter(x=>x===t).length >= 3 && !eliteOn(engine.board, pid, t));
    if (cand.length && rnd(100) < upgradeRate) {
      type = cand[rnd(cand.length)];    // 隨機挑，避免偏向劍
      rank = 2; eliteAt[pid][type] = engine.roundNo;
    }
    const res = engine.deploy(pid, { r, c, type, rank, turnId: engine.turnId });
    if (!res.ok && !engine.deploy(pid, { r, c, type: hand[0], rank: 1, turnId: engine.turnId }).ok) break;
  }
}
const pct = (a,b) => b ? (100*a/b).toFixed(1)+"%" : "—";
const avg = a => a.length ? (a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : "—";
const GAMES = 3000;
console.log(`每組 ${GAMES} 局。「想放克制卻沒牌」依「該兵種★★做出後幾輪」分桶（窗口 ${WINDOW} 輪）\n`);
console.log("升星率 | 剛做完該兵種★★ ≤4輪 | 做過但已過4輪 | 從沒做過該兵種★★");
console.log("-".repeat(78));
for (const rate of [25, 50, 75, 100]) {
  const S = { never:{wants:0,starved:0}, inWindow:{wants:0,starved:0}, afterWindow:{wants:0,starved:0},
              diversity:{ never:[], made:[] } };
  for (let i = 0; i < GAMES; i++) playGame(2000 + i*7919, rate, S);
  console.log(`${String(rate).padStart(5)}% | ${(pct(S.inWindow.starved,S.inWindow.wants)+` (n=${S.inWindow.wants})`).padStart(21)}`
    + ` | ${(pct(S.afterWindow.starved,S.afterWindow.wants)+` (n=${S.afterWindow.wants})`).padStart(20)}`
    + ` | ${(pct(S.never.starved,S.never.wants)+` (n=${S.never.wants})`).padStart(21)}`);
  if (rate === 100) console.log(`\n手牌兵種多樣性：做過★★的 ${avg(S.diversity.made)} 種 vs 沒做過的 ${avg(S.diversity.never)} 種（手牌 5 張，最多 3 種）`);
}
