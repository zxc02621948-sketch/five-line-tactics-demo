// 加賽的真實長度：用「互相爭奪、會攻擊對方」的對局（正常局約 2.9% 會同時五連），
// 而不是雙方鏡像各做各的。後者是消極判負會在第 3 輪攔掉的局面。
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const TYPE_LIST=["sword","shield","spear"]; const N=9;
function makeRng(s0){let s=s0>>>0;return m=>{s=(s*1664525+1013904223)>>>0;return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
function contested(b,r,c,pid){ let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) for(const o of [pid,pid===1?2:1]){
    let run=0,open=0;
    for(const sg of [1,-1]){let k=1; while(k<5){const nr=r+dr*k*sg,nc=c+dc*k*sg;
      if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==o){if(inB(nr,nc)&&!b[nr][nc])open++;break;} run++;k++;}}
    if(run>=1) sc+=(o===pid?1:0.9)*(run*run)*(open?1:0.4); }
  return sc+0.01*(4-Math.abs(r-4))+0.01*(4-Math.abs(c-4)); }
const GRACE=3, GUARD=500;
function play(seed, rate, S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"OT2",...ALPHA_TURN_ORDER,randomInt:rnd});
  const realFive=e.fiveLines.bind(e);
  let overtime=false, otStart=null, otRound=0;
  e.fiveLines=(pid)=> overtime ? [] : realFive(pid);
  let guard=0;
  while(guard++<GUARD){
    if(e.gameOver && !overtime){
      if(e.winner!=="draw"){ S.normal++; return; }
      overtime=true; otStart=e.roundNo; e.gameOver=false; e.winner=null;
      e.roundNo++; e.actionsThisRound=0; e.current=e.firstPlayerForRound();
      e.deploymentCommitted=false; e.ownerTurnStart(e.current);
    }
    const pid=e.current, hand=e.players[pid-1].hand;
    if(hand.length && e.hasEmptyCell()){
      let best=null,bs=-Infinity;
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(e.board[r][c])continue;
        const s=contested(e.board,r,c,pid); if(s>bs){bs=s;best=[r,c];} }
      const type=TYPE_LIST.filter(t=>hand.includes(t))
        .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
      if(!e.deploy(pid,{r:best[0],c:best[1],type,rank:1,turnId:e.turnId}).ok) break;
    } else e.finishDeployment();
    if(!overtime || e.actionsThisRound!==0) continue;
    otRound = e.roundNo - otStart;
    if(otRound>GRACE){
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){ const u=e.board[r][c]; if(!u)continue;
        u.hp -= Math.max(1, Math.round(u.maxHp*rate));
        if(u.hp<=0){ e.players[u.pid-1].cooldown.push({type:u.type,turns:3}); e.board[r][c]=null; } }
    }
    const p1=realFive(1), p2=realFive(2);
    if(p1.length && !p2.length){ S.w1++; S.otLen.push(otRound); return; }
    if(p2.length && !p1.length){ S.w2++; S.otLen.push(otRound); return; }
  }
  if(overtime) S.neverEnds++;
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const G=20000;
console.log(`${G} 局爭奪型對局，只有同時五連的那些會進加賽。緩衝 ${GRACE} 輪\n`);
console.log("每輪扣血 | 進加賽的局 | 加賽收斂 | 加賽長度(輪) | 最長 | 打不完");
console.log("-".repeat(72));
for(const rate of [0.10,0.15]){
  const S={normal:0,w1:0,w2:0,otLen:[],neverEnds:0};
  for(let i=0;i<G;i++) play(11000+i*7919, rate, S);
  const ot=S.w1+S.w2+S.neverEnds;
  console.log(`${(rate*100+"%").padStart(8)} |${(pct(ot,G)+` (${ot})`).padStart(12)}`
    +`|${pct(S.w1+S.w2,ot).padStart(10)}|${avg(S.otLen).padStart(14)}`
    +`|${String(S.otLen.length?Math.max(...S.otLen):"—").padStart(6)}|${pct(S.neverEnds,ot).padStart(8)}`);
}
