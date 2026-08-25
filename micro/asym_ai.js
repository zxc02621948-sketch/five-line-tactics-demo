// 先手／後手邏輯不對稱的 AI。三個先前的偏差已修正：
//   1. 會做 ★★（一次吃 3 張牌，這對牌流影響很大）
//   2. 先手與後手都有炮擊邏輯（先前只有後手會用炮，等於白送後手優勢）
//   3. 炮擊不只用於破線，也會主動用來清場
// 固定 P1 -> P2 -> 結算：後手看得到先手落子；同輪「破線 + 自己五連」直接贏。
const { GameEngine, ALPHA_TURN_ORDER, TYPES } = require("../game_engine.js");
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const TYPE_LIST = ["sword", "shield", "spear"];
const N = 9;
const ART = GameEngine.artilleryRules();
function makeRng(s0) { let s = s0 >>> 0; return m => { s = (s * 1664525 + 1013904223) >>> 0; return Math.floor((s / 4294967296) * m); }; }
const inB = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const cloneBoard = b => b.map(row => row.map(u => u ? { ...u } : null));

function lineVal(b, r, c, pid) {
  let sc = 0;
  for (const d of [[1, 0], [0, 1], [1, 1], [1, -1]]) for (const o of [pid, pid === 1 ? 2 : 1]) {
    let run = 0, open = 0;
    for (const sg of [1, -1]) {
      let k = 1;
      while (k < 5) {
        const nr = r + d[0] * k * sg, nc = c + d[1] * k * sg;
        if (!inB(nr, nc) || !b[nr][nc] || b[nr][nc].pid !== o) { if (inB(nr, nc) && !b[nr][nc]) open++; break; }
        run++; k++;
      }
    }
    if (run >= 1) sc += (o === pid ? 1 : 0.95) * (run * run) * (open ? 1 : 0.4);
  }
  return sc + 0.01 * (4 - Math.abs(r - 4)) + 0.01 * (4 - Math.abs(c - 4));
}

function scratch(board) {
  const s = new GameEngine({ roomCode: "SIM", turnOrderMode: "fixed", startingPlayer: 1, randomInt: () => 0 });
  s.board = board;
  return s;
}
function settle(board) {
  const s = scratch(board);
  s.resolveCombat();
  return { p1: s.fiveLines(1).length, p2: s.fiveLines(2).length };
}
const fiveCount = (board, pid) => scratch(board).fiveLines(pid).length;
const fiveOf = (res, pid) => pid === 1 ? res.p1 : res.p2;

function applyArtillery(board, r, c) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const nr = r + dr, nc = c + dc;
    if (!inB(nr, nc)) continue;
    const u = board[nr][nc];
    if (!u) continue;
    u.hp -= (dr === 0 && dc === 0) ? ART.center : ART.outer;
    if (u.hp <= 0) board[nr][nc] = null;
  }
}

function pickType(board, hand, pid, r, c) {
  const want = {};
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k <= 2; k++) {
    const nr = r + d[0] * k, nc = c + d[1] * k;
    if (!inB(nr, nc)) break;
    const u = board[nr][nc];
    if (!u) continue;
    if (u.pid !== pid) {
      const w = TYPE_LIST.find(t => COUNTER[t] === u.type);
      want[w] = (want[w] || 0) + (u.rank === 2 ? 3 : 1) / k;
    }
    break;
  }
  const ranked = Object.entries(want).sort((a, b) => b[1] - a[1]).map(x => x[0]).filter(t => hand.includes(t));
  if (ranked.length) return ranked[0];
  return TYPE_LIST.filter(t => hand.includes(t))
    .sort((a, b) => hand.filter(x => x === b).length - hand.filter(x => x === a).length)[0];
}

function topCells(board, pid, limit) {
  const cells = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!board[r][c]) cells.push([r, c, lineVal(board, r, c, pid)]);
  cells.sort((a, b) => b[2] - a[2]);
  return cells.slice(0, limit);
}

const mkUnit = (id, pid, type, rank) => {
  const t = TYPES[type];
  const hp = rank === 2 ? Math.round(t.hp * 1.5) : t.hp;
  return { id, pid, type, rank, cards: rank === 2 ? 3 : 1, hp, maxHp: hp, atk: t.atk };
};
const eliteOnBoard = (board, pid, type) =>
  board.some(row => row.some(u => u && u.pid === pid && u.type === type && u.rank === 2));

// 這一手可以放 ★★ 嗎？回傳可升星的兵種
function eliteOptions(board, hand, pid) {
  return TYPE_LIST.filter(t => hand.filter(x => x === t).length >= 3 && !eliteOnBoard(board, pid, t));
}

// ---- 炮擊評估：雙方共用，不再只給後手 ----
// 回傳最佳炮擊點與其價值；價值同時考慮擊殺、破線、誤傷友軍。
function bestArtillery(board, pid) {
  const foe = pid === 1 ? 2 : 1;
  let best = null, bestScore = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let enemies = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && board[nr][nc]) enemies++;
    }
    if (!enemies) continue;
    const after = cloneBoard(board);
    applyArtillery(after, r, c);
    let kills = 0, losses = 0;
    for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) {
      const was = board[rr][cc], now = after[rr][cc];
      if (was && !now) { if (was.pid === foe) kills++; else losses++; }
    }
    const brokeLine = fiveCount(board, foe) > 0 && fiveCount(after, foe) === 0;
    // 打掉對方的四連威脅也算數
    const threatBefore = countOpenFours(board, foe);
    const threatAfter = countOpenFours(after, foe);
    let score = kills * 100 - losses * 140 + (threatBefore - threatAfter) * 60;
    if (brokeLine) score += 5000;
    if (score > bestScore) { bestScore = score; best = { r, c, kills, losses, score }; }
  }
  return best;
}
// 對方有幾條「再放一顆就五連」的線
function countOpenFours(board, pid) {
  let n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c]) continue;
    board[r][c] = { pid, type: "shield", rank: 1 };
    if (fiveCount(board, pid) > 0) n++;
    board[r][c] = null;
  }
  return n;
}

function winningCells(board, pid) {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c]) continue;
    board[r][c] = { pid, type: "shield", rank: 1 };
    if (fiveCount(board, pid) > 0) out.push([r, c]);
    board[r][c] = null;
  }
  return out;
}

function threatSurvivesAnyReply(board, pid, foe, foeArt) {
  const replies = [];
  for (const cell of topCells(board, foe, 6)) replies.push({ kind: "deploy", r: cell[0], c: cell[1] });
  if (foeArt) {
    const a = bestArtillery(board, foe);
    if (a) replies.push({ kind: "art", r: a.r, c: a.c });
  }
  for (const rep of replies) {
    const b = cloneBoard(board);
    if (rep.kind === "art") applyArtillery(b, rep.r, rep.c);
    else b[rep.r][rep.c] = mkUnit(9997, foe, "spear", 1);
    if (winningCells(b, pid).length === 0) return false;
  }
  return true;
}

function foeCanBreak(board, pid, foe, foeArt) {
  for (const cell of topCells(board, foe, 6)) {
    const b = cloneBoard(board);
    b[cell[0]][cell[1]] = mkUnit(9998, foe, "spear", 1);
    if (fiveOf(settle(b), pid) === 0) return true;
  }
  if (foeArt) {
    const a = bestArtillery(board, foe);
    if (a) {
      const b = cloneBoard(board);
      applyArtillery(b, a.r, a.c);
      if (fiveOf(settle(b), pid) === 0) return true;
    }
  }
  return false;
}

// 部署候選（含 ★★）
function deployCandidates(board, hand, pid) {
  const out = [];
  const elites = eliteOptions(board, hand, pid);
  for (const cell of topCells(board, pid, 10)) {
    const r = cell[0], c = cell[1];
    const type = pickType(board, hand, pid, r, c);
    if (type) out.push({ r, c, type, rank: 1 });
    for (const et of elites) out.push({ r, c, type: et, rank: 2 });
  }
  return out;
}

function chooseAction(engine, pid, S, isSecond) {
  const foe = pid === 1 ? 2 : 1;
  const board = engine.board;
  const hand = engine.players[pid - 1].hand;
  const myArt = engine.players[pid - 1].artillery > 0;
  const foeArt = engine.players[foe - 1].artillery > 0;
  const foeHasFive = fiveCount(board, foe) > 0;

  // 先決定要不要炮擊（兩邊都會評估，不再只有後手）
  let artPlan = null;
  if (myArt) {
    const a = bestArtillery(board, pid);
    // 後手面對已成形的五連，門檻放寬；一般情況要有明確收益才用
    const threshold = (isSecond && foeHasFive) ? 1 : 150;
    if (a && a.score >= threshold) artPlan = a;
  }

  const working = artPlan ? (() => { const b = cloneBoard(board); applyArtillery(b, artPlan.r, artPlan.c); return b; })() : board;

  let best = null, bestScore = -Infinity;
  for (const cand of deployCandidates(working, hand, pid)) {
    if (working[cand.r][cand.c]) continue;
    const b1 = cloneBoard(working);
    b1[cand.r][cand.c] = mkUnit(9999, pid, cand.type, cand.rank);
    const s1 = settle(b1);
    let score = lineVal(working, cand.r, cand.c, pid);
    if (cand.rank === 2) score += 25;                       // ★★ 更耐打，但吃 3 張牌
    if (fiveOf(s1, pid) > 0 && fiveOf(s1, foe) === 0) score += 100000;
    else if (isSecond && foeHasFive && fiveOf(s1, foe) === 0) score += 5000;
    else if (isSecond && foeHasFive) score -= 3000;
    if (!isSecond && fiveCount(b1, pid) > 0 && fiveOf(s1, pid) > 0) {
      // 先手：完成五連不等於獲勝，先確認後手破不掉
      if (foeCanBreak(b1, pid, foe, foeArt)) { score -= 2000; S.firstAvoided++; }
    }
    if (!isSecond && fiveCount(b1, pid) === 0) {
      const threats = winningCells(b1, pid);
      if (threats.length >= 2 && threatSurvivesAnyReply(b1, pid, foe, foeArt)) {
        score += 50000; S.doubleThreat++;
      } else if (threats.length >= 2) score += 800;
      else if (threats.length === 1) score += 120;
    }
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  if (!best) return null;
  if (isSecond && bestScore >= 100000) S.secondWin++;
  return { art: artPlan, deploy: best };
}

function play(seed, spec, S) {
  const rnd = makeRng(seed);
  const engine = new GameEngine({ roomCode: "AS", ...ALPHA_TURN_ORDER, randomInt: rnd });
  if (spec) {
    const tpl = [];
    for (const t of TYPE_LIST) for (let i = 0; i < spec[t]; i++) tpl.push(t);
    for (const p of engine.players) { p.deck = engine.shuffle([...tpl]); p.hand = []; p.cooldown = []; }
    engine.drawToFive(1);
    engine.drawToFive(2);
  }
  let guard = 0;
  while (!engine.gameOver && guard++ < 300) {
    const pid = engine.current;
    S.turns++;
    if (engine.actionsThisRound === 0) {
      const round = engine.roundNo;
      if (!S.supply[round]) S.supply[round] = { n: 0, sum: 0, elites: 0 };
      S.supply[round].n++;
      S.supply[round].sum += engine.players[0].hand.length + engine.players[0].deck.length;
      S.supply[round].elites += engine.board.flat().filter(u => u && u.rank === 2).length;
    }
    if (!engine.canDeploy(pid)) {
      S.emptyHand++;
      const moves = engine.legalMoves(pid);
      if (!moves.length) { S.skip++; break; }
      S.moveTurns++;
      let bm = null, bg = -Infinity;
      for (const m of moves) {
        const before = lineVal(engine.board, m.from[0], m.from[1], pid);
        const tmp = engine.board[m.from[0]][m.from[1]];
        engine.board[m.from[0]][m.from[1]] = null;
        const after = lineVal(engine.board, m.to[0], m.to[1], pid);
        engine.board[m.from[0]][m.from[1]] = tmp;
        if (after - before > bg) { bg = after - before; bm = m; }
      }
      if (!engine.move(pid, { r: bm.from[0], c: bm.from[1], toR: bm.to[0], toC: bm.to[1], turnId: engine.turnId }).ok) break;
      continue;
    }
    const isSecond = engine.actionsThisRound === 1;
    const plan = chooseAction(engine, pid, S, isSecond);
    if (!plan) break;
    if (plan.art) {
      if (engine.artillery(pid, { r: plan.art.r, c: plan.art.c, turnId: engine.turnId }).ok) S.art[pid]++;
    }
    let { r, c, type, rank } = plan.deploy;
    if (engine.board[r][c] || engine.players[pid - 1].hand.filter(x => x === type).length < (rank === 2 ? 3 : 1)) {
      rank = 1;
      const hand = engine.players[pid - 1].hand;
      type = hand[0];
      if (engine.board[r][c]) {
        let found = false;
        for (let rr = 0; rr < N && !found; rr++) for (let cc = 0; cc < N; cc++) if (!engine.board[rr][cc]) { r = rr; c = cc; found = true; break; }
        if (!found) break;
      }
    }
    const res = engine.deploy(pid, { r, c, type, rank, turnId: engine.turnId });
    if (!res.ok) {
      const hand = engine.players[pid - 1].hand;
      if (!engine.deploy(pid, { r, c, type: hand[0], rank: 1, turnId: engine.turnId }).ok) break;
    } else if (rank === 2) S.elitesMade[pid]++;
  }
  S.games++;
  S.rounds.push(engine.roundNo);
  for (const pid of [1, 2]) S.artLeft[pid] += engine.players[pid - 1].artillery;
  if (engine.winner === 1) S.w1++;
  else if (engine.winner === 2) S.w2++;
  else if (engine.winner === "draw") S.draw++;
  else if (engine.winner === "double_loss") S.dl++;
  else S.unfinished++;
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "-";
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "-";
const G = Number(process.env.G || 150);

console.log("每組 " + G + " 局。★★ 已納入，炮擊雙方都會用\n");
console.log("牌組         | P1勝 | P2勝 | 局長 |P1★★|P2★★|P1用炮|P2用炮|P1剩炮|P2剩炮|手牌用盡|移動");
console.log("-".repeat(108));
const supplies = {};
for (const cfg of [["25張 (9/9/7)", null], ["20張 (7/7/6)", { sword: 7, shield: 7, spear: 6 }]]) {
  const S = {
    games: 0, turns: 0, w1: 0, w2: 0, draw: 0, dl: 0, unfinished: 0, rounds: [],
    emptyHand: 0, moveTurns: 0, skip: 0, secondWin: 0, firstAvoided: 0, doubleThreat: 0,
    art: { 1: 0, 2: 0 }, artLeft: { 1: 0, 2: 0 }, elitesMade: { 1: 0, 2: 0 }, supply: {},
  };
  for (let i = 0; i < G; i++) play(9000 + i * 7919, cfg[1], S);
  supplies[cfg[0]] = S.supply;
  const per = x => (x / S.games).toFixed(2);
  console.log(cfg[0].padEnd(13) + "|" + pct(S.w1, S.games).padStart(6) + "|" + pct(S.w2, S.games).padStart(6)
    + "|" + avg(S.rounds).padStart(6) + "|" + per(S.elitesMade[1]).padStart(5) + "|" + per(S.elitesMade[2]).padStart(5)
    + "|" + per(S.art[1]).padStart(6) + "|" + per(S.art[2]).padStart(6)
    + "|" + per(S.artLeft[1]).padStart(6) + "|" + per(S.artLeft[2]).padStart(6)
    + "|" + pct(S.emptyHand, S.turns).padStart(8) + "|" + pct(S.moveTurns, S.turns).padStart(6));
  console.log("   後手同輪反殺 " + S.secondWin + "｜先手避開會被破的五連 " + S.firstAvoided
    + "｜雙頭局成立 " + S.doubleThreat + "｜未分勝負 " + S.unfinished);
}

console.log("\n=== 牌流（P1 手牌+牌庫 / 場上★★總數）===");
console.log("輪次 |     25張      |     20張");
console.log("-".repeat(40));
const s25 = supplies["25張 (9/9/7)"], s20 = supplies["20張 (7/7/6)"];
for (let round = 1; round <= 30; round += 2) {
  const a = s25[round], b = s20[round];
  if (!a && !b) continue;
  const fmt = x => x ? ((x.sum / x.n).toFixed(1) + " / " + (x.elites / x.n).toFixed(2)).padStart(13) : "      -      ";
  console.log(String(round).padStart(4) + " |" + fmt(a) + " |" + fmt(b));
}
