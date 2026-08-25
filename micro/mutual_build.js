// 你描述的默契局：雙方各自在自己那邊做線、完全不互相干涉。
// 問題：先做完的人是「立刻贏」，還是雙方同輪達成 → 平手？
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
const TYPE_LIST=["sword","shield","spear"]; const N=9;
function makeRng(s0){let s=s0>>>0;return m=>{s=(s*1664525+1013904223)>>>0;return Math.floor((s/4294967296)*m);};}
const inB=(r,c)=>r>=0&&c>=0&&r<N&&c<N;
// 只看自己的線，完全不管對手
function ownLine(b,r,c,pid){ let sc=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]){
    let run=0,open=0;
    for(const sg of [1,-1]){let k=1; while(k<5){const nr=r+dr*k*sg,nc=c+dc*k*sg;
      if(!inB(nr,nc)||!b[nr][nc]||b[nr][nc].pid!==pid){if(inB(nr,nc)&&!b[nr][nc])open++;break;} run++;k++;}}
    if(run>=1) sc+=(run*run)*(open?1:0.4); }
  return sc; }
const HOME={1:[1,1],2:[7,7]};
function play(seed,S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"MB",...ALPHA_TURN_ORDER,randomInt:rnd});
  const fought=[]; const orig=e.resolveCombat.bind(e);
  e.resolveCombat=()=>{const r=orig(); fought.push(r.packets.length>0); return r;};
  let guard=0;
  while(!e.gameOver&&guard++<400){
    const pid=e.current,hand=e.players[pid-1].hand;
    if(!hand.length||!e.hasEmptyCell())break;
    const [hr,hc]=HOME[pid];
    let best=null,bs=-Infinity;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){
      if(e.board[r][c])continue;
      // 只做自己的線，並且黏在自己家那一角（＝互不干涉）
      const s=ownLine(e.board,r,c,pid) - 0.05*(Math.abs(r-hr)+Math.abs(c-hc));
      if(s>bs){bs=s;best=[r,c];} }
    const type=TYPE_LIST.filter(t=>hand.includes(t))
      .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
    if(!e.deploy(pid,{r:best[0],c:best[1],type,rank:1,turnId:e.turnId}).ok) break;
  }
  S.games++;
  S.rounds.push(e.roundNo);
  if(e.winner===1)S.w1++; else if(e.winner==="draw")S.draw++; else if(e.winner===2)S.w2++; else S.none++;
  if(e.finalFive) S.bothLines += (e.finalFive.p1.length && e.finalFive.p2.length) ? 1 : 0;
  const streak=(a)=>{let m=0,cur=0;for(const f of a){if(f)cur=0;else{cur++;m=Math.max(m,cur);}}return m;};
  S.maxStreak.push(streak(fought));
  for(const k of [2,3,4]) if(streak(fought)>=k) S.trig[k]++;
  // 消極判負會在第幾輪觸發（連續無戰鬥達 3 輪）
  let cur=0, fire=null;
  fought.forEach((f,i)=>{ if(f)cur=0; else {cur++; if(cur>=3&&fire===null)fire=i+1;} });
  if(fire!==null) S.fireRound.push(fire);
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const G=4000;
const S={games:0,w1:0,w2:0,draw:0,none:0,rounds:[],bothLines:0,maxStreak:[],trig:{2:0,3:0,4:0},fireRound:[]};
for(let i=0;i<G;i++) play(8000+i*7919,S);
console.log(`${G} 局：雙方各自在自己那角做線、互不干涉\n`);
console.log(`平均局長 ${avg(S.rounds)} 輪`);
console.log(`P1 獨自五連獲勝 ${pct(S.w1,S.games)}`);
console.log(`P2 獨自五連獲勝 ${pct(S.w2,S.games)}`);
console.log(`雙方同輪五連（現行＝平手）${pct(S.draw,S.games)}`);
console.log(`未分出勝負 ${pct(S.none,S.games)}`);
console.log(`
這種局裡的戰鬥狀況：最長無戰鬥連段平均 ${avg(S.maxStreak)} 輪`);
for(const k of [2,3,4]) console.log(`  連 ${k} 輪無戰鬥的局：${pct(S.trig[k],S.games)}`);
console.log(`  「連3輪不交戰判負」會在第 ${avg(S.fireRound)} 輪觸發（平局在第 ${avg(S.rounds)} 輪才發生）`);
