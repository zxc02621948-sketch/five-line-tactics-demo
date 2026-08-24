// 測「做了 ★★ 之後，需要克制時放不出該兵種」的實際發生率。
// 用正式 game_engine.js，AI 主動找克制（模擬人類會打克制的前提）。
const { GameEngine, ALPHA_TURN_ORDER, TYPES } = require("../game_engine.js");
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const TYPE_LIST = ["sword", "shield", "spear"];
const N = 9;

function makeRng(seed) {
  let s = seed >>> 0;
  return (max) => { s = (s * 1664525 + 1013904223) >>> 0; return Math.floor((s / 4294967296) * max); };
}
const inB = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

// 連線價值：自己延長 + 擋對手
function cellScore(board, r, c, pid) {
  if (board[r][c]) return -1;
  let score = 0;
  for (const [dr, dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    for (const owner of [pid, pid === 1 ? 2 : 1]) {
      let run = 0, open = 0;
      for (const sign of [1, -1]) {
        let k = 1;
        while (k < 5) {
          const nr = r + dr*k*sign, nc = c + dc*k*sign;
          if (!inB(nr, nc) || !board[nr][nc] || board[nr][nc].pid !== owner) {
            if (inB(nr, nc) && !board[nr][nc]) open++;
            break;
          }
          run++; k++;
        }
      }
      if (run >= 1) score += (owner === pid ? 1 : 0.9) * (run * run) * (open ? 1 : 0.4);
    }
  }
  return score + 0.01 * (4 - Math.abs(r - 4)) + 0.01 * (4 - Math.abs(c - 4));
}

// 這格附近有哪些敵人（正交 2 格內）→ 我「想要」的克制兵種
function wantedTypeAt(board, r, c, pid) {
  const tally = {};
  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    for (let k = 1; k <= 2; k++) {
      const nr = r + dr*k, nc = c + dc*k;
      if (!inB(nr, nc)) break;
      const u = board[nr][nc];
      if (!u) continue;
      if (u.pid !== pid) {
        // 想放「剋制 u.type」的兵種：找出誰剋 u.type
        const want = TYPE_LIST.find(t => COUNTER[t] === u.type);
        const weight = (u.rank === 2 ? 3 : 1) / k;   // ★★ 更值得針對，越近越急
        tally[want] = (tally[want] || 0) + weight;
      }
      break;   // 被擋住就不看更遠
    }
  }
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return entries.length ? { type: entries[0][0], urgency: entries[0][1] } : null;
}

function eliteOn(board, pid, type) {
  for (const row of board) for (const u of row)
    if (u && u.pid === pid && u.type === type && u.rank === 2) return true;
  return false;
}

function playGame(seed, upgradeRate, stats) {
  const rnd = makeRng(seed);
  const engine = new GameEngine({ roomCode: "CS", ...ALPHA_TURN_ORDER, randomInt: rnd });
  let guard = 0;
  while (!engine.gameOver && guard++ < 400) {
    const pid = engine.current;
    const player = engine.players[pid - 1];
    const hand = player.hand;
    if (!hand.length || !engine.hasEmptyCell()) break;

    // 選格
    let best = null, bestScore = -Infinity;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const s = cellScore(engine.board, r, c, pid);
      if (s > bestScore) { bestScore = s; best = [r, c]; }
    }
    const [r, c] = best;

    // 這格想要什麼兵種
    const want = wantedTypeAt(engine.board, r, c, pid);
    const hasElite = TYPE_LIST.some(t => eliteOn(engine.board, pid, t));
    if (want) {
      const have = hand.includes(want.type);
      const bucket = hasElite ? stats.withElite : stats.noElite;
      bucket.wants++;
      if (!have) bucket.starved++;
      if (want.urgency >= 2) {        // 針對 ★★ 或貼臉的急迫需求
        bucket.urgentWants++;
        if (!have) bucket.urgentStarved++;
      }
    }

    // 決定要放什麼：優先克制，其次手牌最多的
    let type = want && hand.includes(want.type) ? want.type
      : TYPE_LIST.filter(t => hand.includes(t))
          .sort((a, b) => hand.filter(x => x === b).length - hand.filter(x => x === a).length)[0];

    // 升星判斷
    let rank = 1;
    const upCandidates = TYPE_LIST.filter(t =>
      hand.filter(x => x === t).length >= 3 && !eliteOn(engine.board, pid, t));
    if (upCandidates.length && rnd(100) < upgradeRate) {
      type = upCandidates[0];
      rank = 2;
      stats.elitesMade[type]++;
      // 記下做完之後該兵種還剩幾張
      const left = player.deck.filter(x => x === type).length
        + hand.filter(x => x === type).length - 3;
      stats.leftAfterElite[type].push(left);
    }

    const res = engine.deploy(pid, { r, c, type, rank, turnId: engine.turnId });
    if (!res.ok) {
      const fb = engine.deploy(pid, { r, c, type: hand[0], rank: 1, turnId: engine.turnId });
      if (!fb.ok) break;
    }
  }
  stats.games++;
  stats.rounds.push(engine.roundNo);
}

function run(upgradeRate, games) {
  const stats = {
    games: 0, rounds: [],
    noElite:   { wants: 0, starved: 0, urgentWants: 0, urgentStarved: 0 },
    withElite: { wants: 0, starved: 0, urgentWants: 0, urgentStarved: 0 },
    elitesMade: { sword: 0, shield: 0, spear: 0 },
    leftAfterElite: { sword: [], shield: [], spear: [] },
  };
  for (let i = 0; i < games; i++) playGame(1000 + i * 7919, upgradeRate, stats);
  return stats;
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "—";
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "—";
const GAMES = 2000;

console.log(`每組 ${GAMES} 局，正式引擎，AI 主動找克制\n`);
console.log("升星率 | 場上有★★時 想放克制卻沒牌 | 沒★★時 | 急迫需求(針對★★/貼臉) 有★★ | 沒★★");
console.log("-".repeat(96));
for (const rate of [0, 25, 50, 75, 100]) {
  const s = run(rate, GAMES);
  const w = s.withElite, n = s.noElite;
  console.log(
    `${String(rate).padStart(5)}% | ${pct(w.starved, w.wants).padStart(26)} | ${pct(n.starved, n.wants).padStart(7)} |`
    + ` ${pct(w.urgentStarved, w.urgentWants).padStart(27)} | ${pct(n.urgentStarved, n.urgentWants).padStart(6)}`);
  if (rate === 100) {
    console.log("\n做出 ★★ 當下，該兵種剩餘可用張數（牌庫＋手牌）：");
    for (const t of TYPE_LIST) {
      const total = t === "spear" ? 7 : 9;
      console.log(`  ★★${TYPES[t].name}（牌庫共 ${total} 張）：做了 ${s.elitesMade[t]} 次，平均還剩 ${avg(s.leftAfterElite[t])} 張`
        + `｜完全沒得放(0張) 佔 ${pct(s.leftAfterElite[t].filter(x => x <= 0).length, s.leftAfterElite[t].length)}`
        + `｜剩 ≤2 張佔 ${pct(s.leftAfterElite[t].filter(x => x <= 2).length, s.leftAfterElite[t].length)}`);
    }
    console.log(`\n平均局長 ${avg(s.rounds)} 輪`);
  }
}
