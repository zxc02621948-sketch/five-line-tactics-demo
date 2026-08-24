// 防守 AI 敏感度測試。規則完全是 Alpha Core v1 候選版，未修改 game_engine.js。
// 三種防守策略各跑 1000 組鏡像對（2000 局），upgradeChance = 50%。
const H = require("./game_harness.js");
const PICKERS = require("./defense_ai.js");
const { GameEngine2, pickType, setSeed, rnd } = H;

const UP = 0.5;
const PAIRS = Number(process.argv[2] || 1000);
const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

function maxRun(board, pid) {
  let best = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (!board[r][c] || board[r][c].pid !== pid) continue;
    for (const [dr, dc] of LINE_DIRS) {
      let n = 0;
      for (let rr = r, cc = c; inB(rr, cc) && board[rr][cc] && board[rr][cc].pid === pid; rr += dr, cc += dc) n++;
      if (n > best) best = n;
    }
  }
  return best;
}

// 純三連：某方向的 3 顆己方棋，落在一個無敵方的五格窗內，且不是任何 own>=4 窗的子集
function pureThrees(board, pid) {
  const found = new Map();
  for (const [dr, dc] of LINE_DIRS) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cells = [];
      let ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!inB(rr, cc)) { ok = false; break; }
        cells.push([rr, cc]);
      }
      if (!ok) continue;
      let own = 0, en = 0;
      const owned = [];
      for (const [rr, cc] of cells) {
        const u = board[rr][cc];
        if (!u) continue;
        if (u.pid === pid) { own++; owned.push([rr, cc]); } else en++;
      }
      if (en || own !== 3) continue;
      const key = `${dr},${dc}|` + owned.map(x => x.join(",")).join("|");
      if (!found.has(key)) found.set(key, { dir: [dr, dc], cells: owned });
    }
  }
  // 過濾掉屬於四／五連的子集
  for (const [key, info] of [...found]) {
    if (isSubsetOfBigger(board, pid, info.cells)) found.delete(key);
  }
  return found;
}
function windowsContaining(board, pid, cells) {
  const out = [];
  for (const [dr, dc] of LINE_DIRS) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const win = [];
      let ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (!inB(rr, cc)) { ok = false; break; }
        win.push([rr, cc]);
      }
      if (!ok) continue;
      if (!cells.every(([cr, cc2]) => win.some(([wr, wc]) => wr === cr && wc === cc2))) continue;
      let own = 0, en = 0;
      for (const [rr, cc] of win) {
        const u = board[rr][cc];
        if (!u) continue;
        if (u.pid === pid) own++; else en++;
      }
      out.push({ own, en });
    }
  }
  return out;
}
const isSubsetOfBigger = (board, pid, cells) =>
  windowsContaining(board, pid, cells).some(w => w.en === 0 && w.own >= 4);

function play(gameSeed, startingPlayer, picker, ST) {
  setSeed(gameSeed);
  const e = new GameEngine2({ turnOrderMode: "fixed", startingPlayer,
    randomInt: max => Math.floor(rnd() * max), reflectRatio: 0.33 });
  const first3 = [null, null], first4 = [null, null];
  const active = [new Map(), new Map()];      // 追蹤中的純三連
  const four = [new Map(), new Map()];        // 追蹤中的四連
  const role = pid => (pid === startingPlayer ? 0 : 1);   // 0=先手 1=後手

  const resolveThrees = (phase) => {
    for (const pid of [1, 2]) {
      const idx = role(pid);
      for (const [key, rec] of [...active[pid - 1]]) {
        const intact = rec.cells.every(([r, c]) => e.board[r][c] && e.board[r][c].pid === pid);
        let outcome = null;
        if (!intact) outcome = "killed";
        else {
          const wins = windowsContaining(e.board, pid, rec.cells);
          const clean = wins.filter(w => w.en === 0);
          if (clean.some(w => w.own >= 4)) outcome = "toFour";
          else if (!clean.length) outcome = "blocked";
        }
        if (!outcome) continue;
        ST.three[idx][outcome]++;
        active[pid - 1].delete(key);
      }
      if (phase !== "combat") continue;
      for (const [key, info] of pureThrees(e.board, pid)) {
        if (active[pid - 1].has(key)) continue;
        active[pid - 1].set(key, { cells: info.cells, formedTurn: ST.turnCounter, ownerChecked: false });
        ST.three[idx].formed++;
      }
    }
  };
  // 純三連形成後，是否撐過「對手的下一次部署」
  const checkSurviveOpponentMove = (moverPid) => {
    const defPid = 3 - moverPid, idx = role(defPid);
    for (const [, rec] of active[defPid - 1]) {
      if (rec.ownerChecked || rec.formedTurn >= ST.turnCounter) continue;
      rec.ownerChecked = true;
      const intact = rec.cells.every(([r, c]) => e.board[r][c] && e.board[r][c].pid === defPid);
      const viable = intact && windowsContaining(e.board, defPid, rec.cells).some(w => w.en === 0);
      ST.three[idx][viable ? "survivedOppMove" : "diedToOppMove"]++;
    }
  };
  const trackFour = (phase) => {
    for (const pid of [1, 2]) {
      const idx = role(pid);
      for (const [key, rec] of [...four[pid - 1]]) {
        if (rec.checkTurn > ST.turnCounter) continue;
        const intact = rec.cells.every(([r, c]) => e.board[r][c] && e.board[r][c].pid === pid);
        const viable = intact && windowsContaining(e.board, pid, rec.cells).some(w => w.en === 0);
        ST.four[idx][viable ? "survivedToOwnMove" : "lost"]++;
        four[pid - 1].delete(key);
      }
      if (phase !== "combat") continue;
      for (const [dr, dc] of LINE_DIRS) for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const cells = [];
        let ok = true;
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (!inB(rr, cc) || !e.board[rr][cc] || e.board[rr][cc].pid !== pid) { ok = false; break; }
          cells.push([rr, cc]);
        }
        if (!ok) continue;
        const key = `${dr},${dc}|${r},${c}`;
        if (four[pid - 1].has(key)) continue;
        if (!windowsContaining(e.board, pid, cells).some(w => w.en === 0)) continue;
        four[pid - 1].set(key, { cells, checkTurn: ST.turnCounter + 2 });
        ST.four[idx].formed++;
      }
    }
  };

  let lastCombat = 0;
  for (let guard = 0; guard < 400 && !e.gameOver; guard++) {
    const pid = e.current, player = e.players[pid - 1];
    ST.turnCounter++;
    if (!player.hand.length) break;
    const cell = picker(e.board, pid);
    if (!cell) break;
    const type = pickType(e.board, player.hand, pid, cell);
    const have = player.hand.filter(t => t === type).length;
    let rank = 1;
    if (have >= 3 && rnd() < UP && !e.hasRank2(pid, type)) rank = 2;
    const res = e.deploy(pid, { r: cell[0], c: cell[1], type, rank, turnId: e.turnId });
    if (!res.ok) e.deploy(pid, { r: cell[0], c: cell[1], type, rank: 1, turnId: e.turnId });

    checkSurviveOpponentMove(pid);
    resolveThrees("action");
    trackFour("action");
    if (e.combatResolutionCount > lastCombat) {
      lastCombat = e.combatResolutionCount;
      resolveThrees("combat");
      trackFour("combat");
    }
    for (const p of [1, 2]) {
      const run = maxRun(e.board, p);
      if (first3[p - 1] === null && run >= 3) first3[p - 1] = e.roundNo;
      if (first4[p - 1] === null && run >= 4) first4[p - 1] = e.roundNo;
    }
  }
  for (const p of [1, 2]) {
    const idx = role(p);
    if (first3[p - 1] !== null) ST.f3[idx].push(first3[p - 1]);
    if (first4[p - 1] !== null) ST.f4[idx].push(first4[p - 1]);
  }
  return { winner: e.winner, rounds: e.roundNo };
}

function blankStats() {
  const t = () => ({ formed: 0, toFour: 0, blocked: 0, killed: 0, survivedOppMove: 0, diedToOppMove: 0 });
  const f = () => ({ formed: 0, survivedToOwnMove: 0, lost: 0 });
  return { first: { w: 0, d: 0, l: 0 }, rounds: 0, games: 0, turnCounter: 0,
    f3: [[], []], f4: [[], []], three: [t(), t()], four: [f(), f()],
    pairBothFirst: 0, pairSameSeat: 0, pairs: 0 };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const pc = v => (v * 100).toFixed(2) + "%";
const rate = (a, b) => b ? pc(a / b) : "-";
const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";

const results = {};
for (const mode of ["A", "B", "C"]) {
  const ST = blankStats();
  for (let p = 0; p < PAIRS; p++) {
    const gs = 1000003 * (p + 1) + 7919;
    const g1 = play(gs, 1, PICKERS[mode], ST);
    const g2 = play(gs, 2, PICKERS[mode], ST);
    for (const [g, starter] of [[g1, 1], [g2, 2]]) {
      ST.games++; ST.rounds += g.rounds;
      if (g.winner === starter) ST.first.w++;
      else if (g.winner) ST.first.l++;
      else ST.first.d++;
    }
    ST.pairs++;
    if (g1.winner === 1 && g2.winner === 2) ST.pairBothFirst++;
    if (g1.winner && g1.winner === g2.winner) ST.pairSameSeat++;
  }
  results[mode] = ST;
}

const LBL = { A: "A 現況 (dw0.85)", B: "B 高防守 (dw1.35)", C: "C 威脅辨識" };
console.log("=".repeat(100));
console.log(`防守 AI 敏感度　Alpha Core v1 候選規則　每種策略 ${PAIRS} 組鏡像對 = ${PAIRS * 2} 局　upgradeChance 50%`);
console.log("=".repeat(100));

console.log("\n【先手優勢】");
console.log("  " + w("策略", 20) + w("W", 7) + w("D", 7) + w("L", 7) + w("match score", 14)
  + w("SE", 9) + w("兩局皆先手勝", 14) + "平均局長");
for (const m of ["A", "B", "C"]) {
  const S = results[m], N = S.games;
  const W = S.first.w / N, D = S.first.d / N, ms = W + 0.5 * D;
  const se = Math.sqrt((W + 0.25 * D - ms * ms) / N);
  console.log("  " + w(LBL[m], 20) + w(S.first.w, 7) + w(S.first.d, 7) + w(S.first.l, 7)
    + w(pc(ms), 14) + w("±" + (se * 100).toFixed(2) + "pt", 9)
    + w(pc(S.pairBothFirst / S.pairs), 14) + (S.rounds / N).toFixed(2));
}

console.log("\n【建線節奏：先手 vs 後手】");
console.log("  " + w("策略", 20) + w("首次3連 先/後", 18) + w("差", 8)
  + w("首次4連 先/後", 18) + w("差", 8) + "達成4連局數 先/後");
for (const m of ["A", "B", "C"]) {
  const S = results[m];
  const a3 = Number(avg(S.f3[0])), b3 = Number(avg(S.f3[1]));
  const a4 = Number(avg(S.f4[0])), b4 = Number(avg(S.f4[1]));
  console.log("  " + w(LBL[m], 20) + w(`${avg(S.f3[0])} / ${avg(S.f3[1])}`, 18) + w((a3 - b3).toFixed(2), 8)
    + w(`${avg(S.f4[0])} / ${avg(S.f4[1])}`, 18) + w((a4 - b4).toFixed(2), 8)
    + `${S.f4[0].length} / ${S.f4[1].length}`);
}

console.log("\n【純三連命運】（每局形成數 ＝ 雙方合計 / 局）");
console.log("  " + w("策略", 20) + w("身分", 7) + w("每局形成", 11) + w("→4連", 10)
  + w("被堵", 10) + w("被戰鬥摧毀", 12) + "撐過對手下一手");
for (const m of ["A", "B", "C"]) {
  const S = results[m];
  for (const [idx, name] of [[0, "先手"], [1, "後手"]]) {
    const t = S.three[idx];
    const closed = t.toFour + t.blocked + t.killed;
    const oppChecked = t.survivedOppMove + t.diedToOppMove;
    console.log("  " + w(idx === 0 ? LBL[m] : "", 20) + w(name, 7)
      + w((t.formed / S.games).toFixed(2), 11)
      + w(rate(t.toFour, closed), 10) + w(rate(t.blocked, closed), 10)
      + w(rate(t.killed, closed), 12) + rate(t.survivedOppMove, oppChecked));
  }
}

console.log("\n【四連形成後撐到自己下一次行動】");
console.log("  " + w("策略", 20) + w("身分", 7) + w("每局形成", 11) + "存活率");
for (const m of ["A", "B", "C"]) {
  const S = results[m];
  for (const [idx, name] of [[0, "先手"], [1, "後手"]]) {
    const f = S.four[idx];
    console.log("  " + w(idx === 0 ? LBL[m] : "", 20) + w(name, 7)
      + w((f.formed / S.games).toFixed(2), 11) + rate(f.survivedToOwnMove, f.survivedToOwnMove + f.lost));
  }
}
