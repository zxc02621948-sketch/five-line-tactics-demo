// 牌流壓力測試：20 張牌組會不會真的沒牌可抽 / 沒牌可放。
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const TYPE_LIST = ["sword", "shield", "spear"];
const N = 9;
function makeRng(seed) { let s = seed >>> 0;
  return (max) => { s = (s*1664525 + 1013904223) >>> 0; return Math.floor((s/4294967296)*max); }; }
const inB = (r,c) => r>=0 && c>=0 && r<N && c<N;
function cellScore(board, r, c, pid) {
  if (board[r][c]) return -1;
  let score = 0;
  for (const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    for (const owner of [pid, pid===1?2:1]) {
      let run=0, open=0;
      for (const sign of [1,-1]) { let k=1;
        while (k<5) { const nr=r+dr*k*sign, nc=c+dc*k*sign;
          if (!inB(nr,nc) || !board[nr][nc] || board[nr][nc].pid!==owner) {
            if (inB(nr,nc) && !board[nr][nc]) open++; break; }
          run++; k++; } }
      if (run>=1) score += (owner===pid?1:0.9)*(run*run)*(open?1:0.4);
    } }
  return score + 0.01*(4-Math.abs(r-4)) + 0.01*(4-Math.abs(c-4));
}
const eliteOn = (b,pid,t) => b.some(row => row.some(u => u && u.pid===pid && u.type===t && u.rank===2));

function play(seed, deckSpec, upgradeRate, S) {
  const rnd = makeRng(seed);
  const engine = new GameEngine({ roomCode: "DF", ...ALPHA_TURN_ORDER, randomInt: rnd });
  const template = [];
  for (const t of TYPE_LIST) for (let i = 0; i < deckSpec[t]; i++) template.push(t);
  for (const p of engine.players) { p.deck = engine.shuffle([...template]); p.hand = []; p.cooldown = []; }
  engine.drawToFive(1); engine.drawToFive(2);

  let guard = 0;
  while (!engine.gameOver && guard++ < 400) {
    const pid = engine.current, player = engine.players[pid-1], hand = player.hand;
    S.turns++;
    S.handSizes.push(hand.length);
    if (hand.length < 5) S.handBelow5++;
    if (hand.length <= 2) S.handBelow3++;
    if (hand.length === 0) { S.handEmpty++; S.deadlockRound.push(engine.roundNo); break; }
    if (player.deck.length === 0) S.deckEmpty++;
    if (!engine.hasEmptyCell()) break;

    // 想升星但湊不到 3 張
    const canMerge = TYPE_LIST.some(t => hand.filter(x=>x===t).length >= 3 && !eliteOn(engine.board,pid,t));
    S.mergeChecks++; if (canMerge) S.mergeAvailable++;

    let best=null, bs=-Infinity;
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
      const s = cellScore(engine.board, r, c, pid);
      if (s>bs) { bs=s; best=[r,c]; } }
    const [r,c] = best;
    let type = TYPE_LIST.filter(t=>hand.includes(t))
      .sort((a,b)=>hand.filter(x=>x===b).length - hand.filter(x=>x===a).length)[0];
    let rank = 1;
    const cand = TYPE_LIST.filter(t => hand.filter(x=>x===t).length>=3 && !eliteOn(engine.board,pid,t));
    if (cand.length && rnd(100) < upgradeRate) { type = cand[rnd(cand.length)]; rank = 2; S.elites++; }

    const res = engine.deploy(pid, { r, c, type, rank, turnId: engine.turnId });
    if (!res.ok && !engine.deploy(pid,{r,c,type:hand[0],rank:1,turnId:engine.turnId}).ok) break;

    if (engine.roundNo === 10 && pid === 1) {
      const d = engine.cardDistribution(1);
      S.snap10.push(d);
    }
  }
  const units = engine.board.flat().filter(u => u && u.pid === 1).length;
  S.unitsOnBoard.push(units);
  S.rounds.push(engine.roundNo);
  S.games++;
}

const pct = (a,b) => b ? (100*a/b).toFixed(1)+"%" : "—";
const avg = a => a.length ? (a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : "—";
const GAMES = 3000;
const CONFIGS = [
  ["現行 25 張 (9/9/7)", { sword:9, shield:9, spear:7 }],
  ["20 張 (7/7/6)",      { sword:7, shield:7, spear:6 }],
  ["18 張 (6/6/6)",      { sword:6, shield:6, spear:6 }],
];
console.log(`每組 ${GAMES} 局\n`);
console.log("牌組 | 升星率 | 手牌<5 | 手牌≤2 | 空手停擺 | 牌庫見底 | 湊得出3張同兵種 | 平均場上兵 | 平均局長");
console.log("-".repeat(112));
for (const [label, spec] of CONFIGS) {
  for (const rate of [0, 50, 100]) {
    const S = { games:0, turns:0, handSizes:[], handBelow5:0, handBelow3:0, handEmpty:0,
      deckEmpty:0, mergeChecks:0, mergeAvailable:0, elites:0, unitsOnBoard:[], rounds:[],
      deadlockRound:[], snap10:[] };
    for (let i=0;i<GAMES;i++) play(3000+i*7919, spec, rate, S);
    console.log(`${label.padEnd(18)}|${String(rate).padStart(5)}% |${pct(S.handBelow5,S.turns).padStart(7)}`
      + `|${pct(S.handBelow3,S.turns).padStart(8)}|${(pct(S.handEmpty,S.games)).padStart(10)}`
      + `|${pct(S.deckEmpty,S.turns).padStart(10)}|${pct(S.mergeAvailable,S.mergeChecks).padStart(17)}`
      + `|${avg(S.unitsOnBoard).padStart(12)}|${avg(S.rounds).padStart(10)}`);
    if (rate === 100 && S.snap10.length) {
      const d = S.snap10;
      const m = k => avg(d.map(x=>x[k]));
      console.log(`   └ 第10輪牌的位置：牌庫 ${m("deck")}｜手牌 ${m("hand")}｜冷卻 ${m("cooldown")}｜場上綁住 ${m("boardBoundCards")}`);
    }
  }
}
