// 「連續 N 輪無交戰即判負」這條規則會不會誤判？先量正常對局的無戰鬥連段分布。
const { GameEngine, ALPHA_TURN_ORDER } = require("../game_engine.js");
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
const eliteOn=(b,pid,t)=>b.some(row=>row.some(u=>u&&u.pid===pid&&u.type===t&&u.rank===2));

function play(seed, rate, S){
  const rnd=makeRng(seed);
  const e=new GameEngine({roomCode:"PS",...ALPHA_TURN_ORDER,randomInt:rnd});
  const fought=[];                        // 每輪有沒有交戰
  const orig=e.resolveCombat.bind(e);
  e.resolveCombat=()=>{ const r=orig(); fought.push(r.packets.length>0); return r; };
  let guard=0;
  while(!e.gameOver&&guard++<400){
    const pid=e.current,player=e.players[pid-1],hand=player.hand;
    if(!hand.length||!e.hasEmptyCell())break;
    let best=null,bs=-Infinity;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){const s=cellScore(e.board,r,c,pid);if(s>bs){bs=s;best=[r,c];}}
    const [r,c]=best;
    let type=TYPE_LIST.filter(t=>hand.includes(t))
      .sort((a,b)=>hand.filter(x=>x===b).length-hand.filter(x=>x===a).length)[0];
    let rank=1;
    const cand=TYPE_LIST.filter(t=>hand.filter(x=>x===t).length>=3&&!eliteOn(e.board,pid,t));
    if(cand.length&&rnd(100)<rate){type=cand[rnd(cand.length)];rank=2;}
    if(!e.deploy(pid,{r,c,type,rank,turnId:e.turnId}).ok
       && !e.deploy(pid,{r,c,type:hand[0],rank:1,turnId:e.turnId}).ok) break;
  }
  // 開局到第一次交戰
  const first=fought.indexOf(true);
  S.firstContact.push(first<0?fought.length:first+1);
  // 最長無戰鬥連段（整局）與（第一次交戰之後）
  const streaks=(arr)=>{let m=0,cur=0;for(const f of arr){if(f)cur=0;else{cur++;m=Math.max(m,cur);}}return m;};
  S.maxStreakAll.push(streaks(fought));
  S.maxStreakAfter.push(first<0?0:streaks(fought.slice(first+1)));
  S.rounds.push(fought.length);
  // 各門檻下會被判負的局
  for(const k of [2,3,4,5]){
    if(streaks(fought)>=k) S.trigAll[k]++;
    if(first>=0 && streaks(fought.slice(first+1))>=k) S.trigAfter[k]++;
  }
  S.games++;
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):"—";
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const G=4000;
for(const rate of [50]){
  const S={games:0,firstContact:[],maxStreakAll:[],maxStreakAfter:[],rounds:[],
    trigAll:{2:0,3:0,4:0,5:0},trigAfter:{2:0,3:0,4:0,5:0}};
  for(let i=0;i<G;i++) play(5000+i*7919,rate,S);
  console.log(`${G} 局，升星率 ${rate}%，平均局長 ${avg(S.rounds)} 輪\n`);
  console.log(`開局到第一次交戰：平均 ${avg(S.firstContact)} 輪，中位數 ${med(S.firstContact)} 輪`);
  console.log(`最長無戰鬥連段：整局 平均 ${avg(S.maxStreakAll)} / 中位 ${med(S.maxStreakAll)}`);
  console.log(`                首次交戰後 平均 ${avg(S.maxStreakAfter)} / 中位 ${med(S.maxStreakAfter)}\n`);
  console.log("門檻 | 從開局就算 會判負的局 | 首次交戰後才算 會判負的局");
  console.log("-".repeat(62));
  for(const k of [2,3,4,5])
    console.log(`${k} 輪 |${pct(S.trigAll[k],S.games).padStart(21)} |${pct(S.trigAfter[k],S.games).padStart(24)}`);
}
