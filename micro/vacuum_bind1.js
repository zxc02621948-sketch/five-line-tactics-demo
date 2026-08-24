// 綁1張＋2張冷卻，克制真空期還剩多少？20 張牌組。
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const COUNTER={sword:"spear",spear:"shield",shield:"sword"};
const TYPE_LIST=["sword","shield","spear"]; const N=9;
function makeRng(s0){let s=s0>>>0;return m=>{s=(s*1664525+1013904223)>>>0;return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
function cellScore(b,r,c,pid){ if(b[r][c])return -1; let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) for(const o of [pid,pid===1?2:1]){
    let run=0,open=0;
    for(const sg of [1,-1]){let k=1; while(k<5){const nr=r+dr*k*sg,nc=c+dc*k*sg;
      if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==o){if(inB(nr,nc)&&!b[nr][nc])open++;break;} run++;k++;}}
    if(run>=1) sc+=(o===pid?1:0.9)*(run*run)*(open?1:0.4); }
  return sc+0.01*(4-Math.abs(r-4))+0.01*(4-Math.abs(c-4)); }
function wantedAt(b,r,c,pid){ const t={};
  for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) for(let k=1;k<=2;k++){
    const nr=r+dr*k,nc=c+dc*k; if(!inB(nr,nc))break;
    const u=b[nr][nc]; if(!u)continue;
    if(u.pid!==pid){const w=TYPE_LIST.find(x=>COUNTER[x]===u.type); t[w]=(t[w]||0)+(u.rank===2?3:1)/k;} break; }
  const e=Object.entries(t).sort((a,b)=>b[1]-a[1]); return e.length?e[0][0]:null; }
const eliteOn=(b,pid,t)=>b.some(row=>row.some(u=>u&&u.pid===pid&&u.type===t&&u.rank===2));
const W=4;
function play(seed,rate,variant,S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"VB",...ALPHA_TURN_ORDER,randomInt:rnd});
  const tpl=[]; for(const t of TYPE_LIST) for(let i=0;i<{sword:7,shield:7,spear:6}[t];i++) tpl.push(t);
  for(const p of e.players){p.deck=e.shuffle([...tpl]);p.hand=[];p.cooldown=[];}
  e.drawToFive(1); e.drawToFive(2);
  const madeAt={1:{},2:{}}; let guard=0;
  while(!e.gameOver&&guard++<400){
    const pid=e.current,player=e.players[pid-1],hand=player.hand;
    if(!hand.length||!e.hasEmptyCell())break;
    let best=null,bs=-Infinity;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){const s=cellScore(e.board,r,c,pid);if(s>bs){bs=s;best=[r,c];}}
    const [r,c]=best;
    const want=wantedAt(e.board,r,c,pid);
    if(want){ const m=madeAt[pid][want];
      const bucket = m===undefined?S.never:(e.roundNo-m<=W?S.inWindow:S.after);
      bucket.wants++; if(!hand.includes(want)) bucket.starved++; }
    let type=want&&hand.includes(want)?want
      :TYPE_LIST.filter(t=>hand.includes(t)).sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
    let rank=1;
    const cand=TYPE_LIST.filter(t=>hand.filter(x=>x===t).length>=3&&!eliteOn(e.board,pid,t));
    if(cand.length&&rnd(100)<rate){type=cand[rnd(cand.length)];rank=2;madeAt[pid][type]=e.roundNo;}
    const res=e.deploy(pid,{r,c,type,rank,turnId:e.turnId});
    if(!res.ok){ if(!e.deploy(pid,{r,c,type:hand[0],rank:1,turnId:e.turnId}).ok) break; }
    else if(rank===2&&variant==="bind1"){ const u=e.board[r][c];
      if(u&&u.rank===2){u.cards=1;player.cooldown.push({type,turns:3},{type,turns:3});} }
  }
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const G=3000;
console.log(`每組 ${G} 局，20 張牌組 (7/7/6)。「想放克制卻沒牌」\n`);
console.log("★★綁牌方式 | 升星率 | 剛做完≤4輪 | 已過4輪 | 從沒做過 | 真空倍率");
console.log("-".repeat(74));
for(const [lab,v] of [["綁 3 張","bind3"],["綁 1 張","bind1"]])
  for(const rate of [50,100]){
    const S={never:{wants:0,starved:0},inWindow:{wants:0,starved:0},after:{wants:0,starved:0}};
    for(let i=0;i<G;i++) play(4000+i*7919,rate,v,S);
    const a=S.inWindow.starved/S.inWindow.wants, b=S.never.starved/S.never.wants;
    console.log(`${lab.padEnd(12)}|${String(rate).padStart(5)}% |${pct(S.inWindow.starved,S.inWindow.wants).padStart(11)}`
      +`|${pct(S.after.starved,S.after.wants).padStart(9)}|${pct(S.never.starved,S.never.wants).padStart(10)}`
      +`|${("×"+(a/b).toFixed(2)).padStart(10)}`);
  }
