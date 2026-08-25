// 加賽階段沙盒：同輪雙方五連 → 進入加賽，只有單方五連才判勝。
// 加賽 3 輪後，每輪全盤扣 maxHP 的 10%。問題：會收斂嗎？誰有利？
const { GameEngine, ALPHA_TURN_ORDER, TYPES } = require("../game_engine.js");
const TYPE_LIST=["sword","shield","spear"]; const N=9;
function makeRng(s0){let s=s0>>>0;return m=>{s=(s*1664525+1013904223)>>>0;return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
function ownLine(b,r,c,pid){ let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]){ let run=0,open=0;
    for(const sg of [1,-1]){let k=1; while(k<5){const nr=r+dr*k*sg,nc=c+dc*k*sg;
      if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==pid){if(inB(nr,nc)&&!b[nr][nc])open++;break;} run++;k++;}}
    if(run>=1) sc+=(run*run)*(open?1:0.4); }
  return sc; }
const HOME={1:[1,1],2:[7,7]};
const GRACE=3, GUARD=800;

function play(seed, mode, S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"OT",...ALPHA_TURN_ORDER,randomInt:rnd});
  const realFive=e.fiveLines.bind(e);
  let overtime=false, otRound=0;
  e.fiveLines=(pid)=> overtime ? [] : realFive(pid);   // 加賽中不讓引擎自己判勝

  let guard=0, otStart=null;
  while(guard++<GUARD){
    if(e.gameOver && !overtime){
      if(e.winner!=="draw") break;                     // 一般勝負，不進加賽
      overtime=true; otStart=e.roundNo; e.gameOver=false; e.winner=null;
      e.roundNo++; e.actionsThisRound=0; e.current=e.firstPlayerForRound();
      e.deploymentCommitted=false; e.ownerTurnStart(e.current);
    }
    const pid=e.current, hand=e.players[pid-1].hand;
    if(hand.length && e.hasEmptyCell()){
      const [hr,hc]=HOME[pid];
      let best=null,bs=-Infinity;
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(e.board[r][c])continue;
        const s=ownLine(e.board,r,c,pid)-0.05*(Math.abs(r-hr)+Math.abs(c-hc));
        if(s>bs){bs=s;best=[r,c];} }
      const type=TYPE_LIST.filter(t=>hand.includes(t))
        .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
      if(!e.deploy(pid,{r:best[0],c:best[1],type,rank:1,turnId:e.turnId}).ok) break;
    } else { e.finishDeployment(); }

    if(!overtime) continue;
    if(e.actionsThisRound!==0) continue;               // 只在整輪結算後處理
    otRound = e.roundNo - otStart;

    if(otRound>GRACE){                                  // 全盤扣血
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){ const u=e.board[r][c]; if(!u)continue;
        const rate = mode.escalate ? mode.rate*(otRound-GRACE) : mode.rate;
        u.hp -= Math.max(1, Math.round(u.maxHp*rate));
        if(u.hp<=0){ e.players[u.pid-1].cooldown.push({type:u.type,turns:3}); e.board[r][c]=null; } }
    }
    const p1=realFive(1), p2=realFive(2);
    if(p1.length && !p2.length){ S.w1++; S.otLen.push(otRound); break; }
    if(p2.length && !p1.length){ S.w2++; S.otLen.push(otRound); break; }
    if(!p1.length && !p2.length) S.bothBroke++;
  }
  S.games++;
  if(otStart===null) S.noOvertime++;
  else if(guard>=GUARD){ S.neverEnds++;
    const alive=e.board.flat().filter(Boolean).length; S.stuckUnits.push(alive); }
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const G=2000;
console.log(`每組 ${G} 局（雙方各做各的 → 100% 進加賽）。緩衝 ${GRACE} 輪後開始扣血\n`);
console.log("扣血規則（每輪，maxHP 比例） | 加賽收斂 | P1勝 | P2勝 | 加賽長度 | 最長 | 打不完");
console.log("-".repeat(92));
const MODES=[
  ["固定 10%", {rate:0.10,escalate:false}],
  ["固定 15%", {rate:0.15,escalate:false}],
  ["固定 20%", {rate:0.20,escalate:false}],
  ["固定 25%", {rate:0.25,escalate:false}],
  ["遞增 10%×第N輪", {rate:0.10,escalate:true}],
  ["遞增 15%×第N輪", {rate:0.15,escalate:true}],
];
for(const [lab,mode] of MODES){
  const S={games:0,w1:0,w2:0,otLen:[],neverEnds:0,noOvertime:0,bothBroke:0,stuckUnits:[]};
  for(let i=0;i<G;i++) play(9000+i*7919, mode, S);
  const conv=S.w1+S.w2;
  console.log(`${lab.padEnd(26)}|${pct(conv,S.games).padStart(10)}|${pct(S.w1,S.games).padStart(6)}`
    +`|${pct(S.w2,S.games).padStart(6)}|${avg(S.otLen).padStart(10)}`
    +`|${String(S.otLen.length?Math.max(...S.otLen):"—").padStart(6)}|${pct(S.neverEnds,S.games).padStart(8)}`);
}
