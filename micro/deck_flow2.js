// 驗證「★★ 消耗3張但只綁1張、另2張進冷卻」能否讓 20 張牌組成立。
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const TYPE_LIST = ["sword","shield","spear"]; const N = 9;
function makeRng(seed){ let s=seed>>>0; return m=>{s=(s*1664525+1013904223)>>>0; return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
function cellScore(b,r,c,pid){ if(b[r][c])return -1; let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) for(const o of [pid,pid===1?2:1]){
    let run=0,open=0;
    for(const sg of [1,-1]){ let k=1;
      while(k<5){ const nr=r+dr*k*sg,nc=c+dc*k*sg;
        if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==o){ if(inB(nr,nc)&&!b[nr][nc])open++; break;} run++;k++; } }
    if(run>=1) sc+=(o===pid?1:0.9)*(run*run)*(open?1:0.4); }
  return sc+0.01*(4-Math.abs(r-4))+0.01*(4-Math.abs(c-4)); }
const eliteOn=(b,pid,t)=>b.some(row=>row.some(u=>u&&u.pid===pid&&u.type===t&&u.rank===2));

// variant: "bind3" = 現行（★★綁3張）, "bind1" = 只綁1張、另2張進冷卻
function play(seed, spec, rate, variant, S){
  const rnd = makeRng(seed);
  const e = new GameEngine({ roomCode:"DF2", ...ALPHA_TURN_ORDER, randomInt: rnd });
  const tpl=[]; for(const t of TYPE_LIST) for(let i=0;i<spec[t];i++) tpl.push(t);
  for(const p of e.players){ p.deck=e.shuffle([...tpl]); p.hand=[]; p.cooldown=[]; }
  e.drawToFive(1); e.drawToFive(2);
  let guard=0;
  while(!e.gameOver && guard++<400){
    const pid=e.current, player=e.players[pid-1], hand=player.hand;
    S.turns++;
    if(hand.length<5) S.handBelow5++;
    if(hand.length===0){ S.handEmpty++; break; }
    if(player.deck.length===0) S.deckEmpty++;
    if(!e.hasEmptyCell()) break;
    let best=null,bs=-Infinity;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){const s=cellScore(e.board,r,c,pid); if(s>bs){bs=s;best=[r,c];}}
    const [r,c]=best;
    let type=TYPE_LIST.filter(t=>hand.includes(t))
      .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
    let rank=1;
    const cand=TYPE_LIST.filter(t=>hand.filter(x=>x===t).length>=3&&!eliteOn(e.board,pid,t));
    if(cand.length&&rnd(100)<rate){ type=cand[rnd(cand.length)]; rank=2; }
    const res=e.deploy(pid,{r,c,type,rank,turnId:e.turnId});
    if(!res.ok){ if(!e.deploy(pid,{r,c,type:hand[0],rank:1,turnId:e.turnId}).ok) break; }
    else if(rank===2 && variant==="bind1"){
      // 改綁 1 張，另 2 張進冷卻（3 輪後回牌庫）
      // 若該★★在同輪戰鬥就陣亡，引擎已把 3 張全推進冷卻，
      // 與「1張上場陣亡 + 2張冷卻」結果相同，不需補正。
      const u=e.board[r][c];
      if(u && u.rank===2){ u.cards=1; player.cooldown.push({type,turns:3},{type,turns:3}); }
    }
    if(e.roundNo===10&&pid===1) S.snap10.push(e.cardDistribution(1));
  }
  S.games++; S.rounds.push(e.roundNo);
  S.units.push(e.board.flat().filter(u=>u&&u.pid===1).length);
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const G=3000;
console.log(`每組 ${G} 局，牌組 20 張 (7/7/6)\n`);
console.log("★★ 綁牌方式 | 升星率 | 手牌<5 | 空手停擺 | 牌庫見底 | 平均場上兵 | 平均局長");
console.log("-".repeat(88));
for(const [vlabel,variant] of [["綁 3 張（現行）","bind3"],["綁 1 張＋2張冷卻","bind1"]])
  for(const rate of [50,100]){
    const S={games:0,turns:0,handBelow5:0,handEmpty:0,deckEmpty:0,rounds:[],units:[],snap10:[]};
    for(let i=0;i<G;i++) play(3000+i*7919,{sword:7,shield:7,spear:6},rate,variant,S);
    console.log(`${vlabel.padEnd(18)}|${String(rate).padStart(5)}% |${pct(S.handBelow5,S.turns).padStart(7)}`
      +`|${pct(S.handEmpty,S.games).padStart(10)}|${pct(S.deckEmpty,S.turns).padStart(10)}`
      +`|${avg(S.units).padStart(12)}|${avg(S.rounds).padStart(10)}`);
    if(rate===100&&S.snap10.length){ const m=k=>avg(S.snap10.map(x=>x[k]));
      console.log(`   └ 第10輪：牌庫 ${m("deck")}｜手牌 ${m("hand")}｜冷卻 ${m("cooldown")}｜場上綁住 ${m("boardBoundCards")}`); }
  }
