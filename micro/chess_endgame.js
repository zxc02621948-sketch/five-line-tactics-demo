// 沙盒：20 張牌組 + 「手牌空了可以移動一顆棋子 1 格」。
// 問題：真的會走到象棋階段嗎？走到之後會不會永遠不結束？
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const TYPE_LIST=["sword","shield","spear"]; const N=9;
function makeRng(s0){let s=s0>>>0;return m=>{s=(s*1664525+1013904223)>>>0;return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
function lineVal(b,r,c,pid){ let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) for(const o of [pid,pid===1?2:1]){
    let run=0,open=0;
    for(const sg of [1,-1]){let k=1; while(k<5){const nr=r+dr*k*sg,nc=c+dc*k*sg;
      if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==o){if(inB(nr,nc)&&!b[nr][nc])open++;break;} run++;k++;}}
    if(run>=1) sc+=(o===pid?1:0.9)*(run*run)*(open?1:0.4); }
  return sc+0.01*(4-Math.abs(r-4))+0.01*(4-Math.abs(c-4)); }

// 移動：找「移過去比留著好」最多的那一步
function bestMove(e,pid){
  let best=null,gain=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const u=e.board[r][c]; if(!u||u.pid!==pid)continue;
    const before=lineVal(e.board,r,c,pid);
    for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nr=r+dr,nc=c+dc;
      if(!inB(nr,nc)||e.board[nr][nc])continue;
      e.board[r][c]=null;
      const after=lineVal(e.board,nr,nc,pid);
      e.board[r][c]=u;
      if(after-before>gain){gain=after-before;best=[r,c,nr,nc];}
    } }
  return best; }

const GUARD=600;
function play(seed, rate, allowMove, S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"CE",...ALPHA_TURN_ORDER,randomInt:rnd});
  const tpl=[]; for(const t of TYPE_LIST) for(let i=0;i<{sword:7,shield:7,spear:6}[t];i++) tpl.push(t);
  for(const p of e.players){p.deck=e.shuffle([...tpl]);p.hand=[];p.cooldown=[];}
  e.drawToFive(1); e.drawToFive(2);
  const fought=[]; const orig=e.resolveCombat.bind(e);
  e.resolveCombat=()=>{const r=orig(); fought.push(r.packets.length>0); return r;};
  let guard=0, moveRounds=0, firstMoveRound=null, stuck=0;
  while(!e.gameOver&&guard++<GUARD){
    const pid=e.current, hand=e.players[pid-1].hand;
    if(hand.length && e.hasEmptyCell()){
      let best=null,bs=-Infinity;
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(e.board[r][c])continue;
        const s=lineVal(e.board,r,c,pid); if(s>bs){bs=s;best=[r,c];} }
      const type=TYPE_LIST.filter(t=>hand.includes(t))
        .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
      let rank=1;
      const cand=TYPE_LIST.filter(t=>hand.filter(x=>x===t).length>=3
        && !e.board.some(row=>row.some(u=>u&&u.pid===pid&&u.type===t&&u.rank===2)));
      if(cand.length&&rnd(100)<rate){rank=2;}
      const t2 = rank===2 ? cand[rnd(cand.length)] : type;
      if(!e.deploy(pid,{r:best[0],c:best[1],type:t2,rank,turnId:e.turnId}).ok
         && !e.deploy(pid,{r:best[0],c:best[1],type:hand[0],rank:1,turnId:e.turnId}).ok) break;
      continue;
    }
    // 手牌空了
    if(!allowMove){ S.deadlock++; break; }
    if(firstMoveRound===null) firstMoveRound=e.roundNo;
    moveRounds++;
    const mv=bestMove(e,pid);
    if(mv){ const [r,c,nr,nc]=mv; e.board[nr][nc]=e.board[r][c]; e.board[r][c]=null; stuck=0; }
    else stuck++;
    e.finishDeployment();
    if(stuck>=4){ S.frozen++; break; }   // 雙方都沒有想走的步
  }
  const ended=e.gameOver;
  S.games++;
  if(!ended && guard>=GUARD) S.neverEnds++;
  if(firstMoveRound!==null){ S.reachedMove++; S.moveStart.push(firstMoveRound); S.movePhase.push(moveRounds); }
  S.rounds.push(e.roundNo);
  const streak=(a)=>{let m=0,cur=0;for(const f of a){if(f)cur=0;else{cur++;m=Math.max(m,cur);}}return m;};
  S.maxStreak.push(streak(fought));
  if(streak(fought)>=3) S.streak3++;
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const G=4000;
console.log(`每組 ${G} 局，20 張牌組 (7/7/6)，上限 ${GUARD} 手\n`);
console.log("移動 | 升星率 | 走到象棋階段 | 進入的輪次 | 象棋階段長度 | 空手死局 | 打不完 | 雙方無步可走 | 連3輪無戰鬥");
console.log("-".repeat(116));
for(const allowMove of [false,true]) for(const rate of [50,100]){
  const S={games:0,deadlock:0,reachedMove:0,moveStart:[],movePhase:[],neverEnds:0,frozen:0,
    rounds:[],maxStreak:[],streak3:0};
  for(let i=0;i<G;i++) play(7000+i*7919,rate,allowMove,S);
  console.log(`${(allowMove?"有":"無").padEnd(5)}|${String(rate).padStart(5)}% |${pct(S.reachedMove,S.games).padStart(14)}`
    +`|${avg(S.moveStart).padStart(12)}|${avg(S.movePhase).padStart(14)}|${pct(S.deadlock,S.games).padStart(10)}`
    +`|${pct(S.neverEnds,S.games).padStart(8)}|${pct(S.frozen,S.games).padStart(14)}|${pct(S.streak3,S.games).padStart(13)}`);
}
