// 想拖的人拖得掉嗎？evader 積極遠離敵人，看能不能製造連續無戰鬥回合。
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
  return sc; }
// 這格放下去會產生幾條交戰關係（自己打人或被打）
function contactCount(b,r,c,pid){
  let n=0;
  for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) for(let k=1;k<=2;k++){
    const nr=r+dr*k,nc=c+dc*k; if(!inB(nr,nc))break;
    const u=b[nr][nc]; if(!u)continue;
    if(u.pid!==pid) n++;      // 相鄰1格必交戰；2格是槍的射程，保守也算
    break; }
  return n; }
function pick(e,pid,style){
  let best=null,bs=-Infinity;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    if(e.board[r][c])continue;
    const line=lineVal(e.board,r,c,pid);
    const contact=contactCount(e.board,r,c,pid);
    const s = style==="evade" ? line - contact*100 : line;   // evader：能不碰就不碰
    const tie = s + 0.01*(4-Math.abs(r-4)) + 0.01*(4-Math.abs(c-4));
    if(tie>bs){bs=tie;best=[r,c];} }
  return best; }
function play(seed, styles, S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"EV",...ALPHA_TURN_ORDER,randomInt:rnd});
  const fought=[]; const orig=e.resolveCombat.bind(e);
  e.resolveCombat=()=>{const r=orig(); fought.push(r.packets.length>0); return r;};
  let guard=0;
  while(!e.gameOver&&guard++<400){
    const pid=e.current,hand=e.players[pid-1].hand;
    if(!hand.length||!e.hasEmptyCell())break;
    const cell=pick(e,pid,styles[pid-1]); if(!cell)break;
    const type=TYPE_LIST.filter(t=>hand.includes(t))
      .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
    if(!e.deploy(pid,{r:cell[0],c:cell[1],type,rank:1,turnId:e.turnId}).ok) break;
  }
  const streak=(arr)=>{let m=0,cur=0;for(const f of arr){if(f)cur=0;else{cur++;m=Math.max(m,cur);}}return m;};
  S.maxStreak.push(streak(fought));
  S.noCombatRounds.push(fought.filter(f=>!f).length);
  S.rounds.push(fought.length);
  for(const k of [2,3,4,5]) if(streak(fought)>=k) S.trig[k]++;
  S.games++;
  if(e.winner===1)S.w1++; else if(e.winner===2)S.w2++; else S.draw++;
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const mx=a=>Math.max(...a);
const G=3000;
console.log(`每組 ${G} 局（純 ★，排除升星變因）\n`);
console.log("P1 vs P2        | 平均局長 | 無戰鬥輪次/局 | 最長無戰鬥連段(平均/最大) | 連3輪無戰鬥的局");
console.log("-".repeat(96));
for(const [lab,styles] of [
  ["一般 vs 一般",["normal","normal"]],
  ["閃避 vs 一般",["evade","normal"]],
  ["閃避 vs 閃避",["evade","evade"]],
]){
  const S={games:0,maxStreak:[],noCombatRounds:[],rounds:[],trig:{2:0,3:0,4:0,5:0},w1:0,w2:0,draw:0};
  for(let i=0;i<G;i++) play(6000+i*7919,styles,S);
  console.log(`${lab.padEnd(16)}|${avg(S.rounds).padStart(10)}|${avg(S.noCombatRounds).padStart(15)}`
    +`|${(avg(S.maxStreak)+" / "+mx(S.maxStreak)).padStart(27)}|${pct(S.trig[3],S.games).padStart(16)}`
    +`|${(pct(S.w1,S.games)+" / "+pct(S.w2,S.games)+" / "+pct(S.draw,S.games)).padStart(22)}`);
}
