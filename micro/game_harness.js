// 候選規則版本的完整棋局測試器。繼承正式 GameEngine（部署／手牌／冷卻／回合／勝負判定），
// 但套用以下候選規則。正式 game_engine.js 未修改。
//   R1  每位玩家、每個兵種，場上同時最多 1 隻 ★★（死亡離場後立即解除）
//   R2  測試牌庫 20 張：劍 7 / 盾 7 / 槍 6（手牌上限仍 5、死亡冷卻仍 3 回合）
//   其餘沿用上一輪：★★ HP×1.5 / ATK×1、斬入＋第二刀、盾不攻擊＋護衛 50%＋反震 33%、
//   槍穿透、盾減傷已移除、★★★ 禁用、不使用炮擊。
const { ConceptEngine } = require("./rank2_concept.js");
const { TYPES } = require("../game_engine.js");
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const TYPE_LIST = ["sword", "shield", "spear"];
const TEST_DECK = { sword: 7, shield: 7, spear: 6 };
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

class GameEngine2 extends ConceptEngine {
  newPlayer(id) {                                   // R2：改用 20 張測試牌庫
    const p = super.newPlayer(id);
    p.deck = this.shuffle(TYPE_LIST.flatMap(t => Array(TEST_DECK[t]).fill(t)));
    p.hand = [];
    return p;
  }
  hasRank2(pid, type) {                             // R1 的查詢
    for (const row of this.board) for (const u of row) {
      if (u && u.pid === pid && u.rank === 2 && u.type === type) return true;
    }
    return false;
  }
  deploy(pid, intent) {
    if (intent.rank === 2 && this.hasRank2(pid, intent.type)) {   // R1：硬性擋下
      return { ok: false, error: "場上已有同兵種二星" };
    }
    const res = super.deploy(pid, intent);
    if (res.ok) {
      const u = this.board[intent.r][intent.c];
      if (u && u.rank === 2) {                      // 二星數值 HP×1.5 / ATK×1
        const base = TYPES[u.type];
        u.maxHp = Math.round(base.hp * 1.5); u.hp = u.maxHp; u.atk = base.atk;
      }
      if (u) u.baseAtk = TYPES[u.type].atk;
    }
    return res;
  }
  available(pid, type) {                            // 立即可用張數 = 牌庫 + 手牌（冷卻中不算）
    const p = this.players[pid - 1];
    return p.deck.filter(t => t === type).length + p.hand.filter(t => t === type).length;
  }
}

function lineScore(board, r, c, pid, dw) {
  let score = -(Math.abs(r - 4) + Math.abs(c - 4)) * 0.05;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    for (let off = -4; off <= 0; off++) {
      let own = 0, enemy = 0, ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * (off + k), cc = c + dc * (off + k);
        if (!inB(rr, cc)) { ok = false; break; }
        const u = board[rr][cc];
        if (u && u.pid === pid) own++; else if (u) enemy++;
      }
      if (!ok || (own && enemy)) continue;
      if (!enemy) score += own * own * 1.15 + (own === 4 ? 500 : 0);
      if (!own) score += dw * (enemy * enemy + (enemy === 4 ? 520 : 0));
    }
  }
  return score;
}

function pickCell(board, pid) {
  let best = [], bestScore = -Infinity;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (board[r][c]) continue;
    let s = lineScore(board, r, c, pid, 0.85);
    for (const [dr, dc] of DIRS) {
      const u = inB(r + dr, c + dc) && board[r + dr][c + dc];
      if (u) s += u.pid === pid ? 0.25 : 0.4;
    }
    if (s > bestScore + 1e-6) { bestScore = s; best = [[r, c]]; }
    else if (Math.abs(s - bestScore) < 1e-6) best.push([r, c]);
  }
  return best.length ? best[Math.floor(rnd() * best.length)] : null;
}

function pickType(board, hand, pid, cell) {
  const count = { sword: 0, shield: 0, spear: 0 };
  hand.forEach(t => count[t]++);
  const [r, c] = cell;
  let best = [], bestScore = -Infinity;
  for (const type of TYPE_LIST.filter(t => count[t])) {
    let s = count[type] * 0.03;
    if (type === "shield") for (const [dr, dc] of DIRS) {
      const a = inB(r + dr, c + dc) && board[r + dr][c + dc];
      if (a && a.pid === pid && a.type !== "shield") s += 2;
    }
    for (const [dr, dc] of DIRS) for (let d = 1; d <= 2; d++) {
      const u = inB(r + dr * d, c + dc * d) && board[r + dr * d][c + dc * d];
      if (!u) continue;
      if (u.pid !== pid) { if (COUNTER[type] === u.type) s += 2; if (type === "spear" && d === 2) s += 0.5; }
      else if (type === "spear") s -= 0.3;
      break;
    }
    if (s > bestScore) { bestScore = s; best = [type]; }
    else if (s === bestScore) best.push(type);
  }
  return best[Math.floor(rnd() * best.length)];
}

const blank = () => ({
  r2ByType: { sword: 0, shield: 0, spear: 0 },
  blockedByUnique: { sword: 0, shield: 0, spear: 0 },   // 通過機率但場上已有同兵種二星 → 取消升星
  eligibleChoseOne: 0,                                  // 有升星資格但擲骰選了一星
  noDeployTurns: 0,                                     // 手牌全空、完全無法部署
  lowAvail: { 0: 0, 1: 0, 2: 0 },                       // 可用牌數落在 0/1/2 的「兵種×行動」計數
  lowRuns: [],                                          // 可用牌數 <=2 的連續回合長度
  turnSamples: 0,
  r2OnBoardSum: 0, r2Samples: 0,
  r2DeathToReady: [],                                   // 二星死亡 → 該兵種再次湊到 3 張的回合數
  cleaves: 0, formed3: 0, formed4: 0, formed5: 0, cleaveWin: 0,
  broke3: 0, broke4: 0, diedSame: 0, diedNextCombat: 0, survivedNextCombat: 0, delta: [],
});

function playGame(upA, upB, gameSeed, startingPlayer) {
  seed = gameSeed;
  const e = new GameEngine2({ turnOrderMode: "fixed", startingPlayer,
    randomInt: max => Math.floor(rnd() * max), reflectRatio: 0.33 });
  const S = [blank(), blank()];
  const watch = new Map();
  const lowRunActive = [{}, {}];
  const pendingReady = [[], []];
  let seen = 0;

  for (let guard = 0; guard < 400 && !e.gameOver; guard++) {
    const pid = e.current, cur = S[pid - 1], player = e.players[pid - 1];
    cur.turnSamples++;

    for (const t of TYPE_LIST) {
      const avail = e.available(pid, t);
      if (avail <= 2) {
        cur.lowAvail[Math.min(avail, 2)]++;
        if (lowRunActive[pid - 1][t] === undefined) lowRunActive[pid - 1][t] = e.roundNo;
      } else if (lowRunActive[pid - 1][t] !== undefined) {
        cur.lowRuns.push(e.roundNo - lowRunActive[pid - 1][t]);
        delete lowRunActive[pid - 1][t];
      }
    }
    for (let i = pendingReady[pid - 1].length - 1; i >= 0; i--) {
      const p = pendingReady[pid - 1][i];
      if (player.hand.filter(t => t === p.type).length >= 3 && !e.hasRank2(pid, p.type)) {
        cur.r2DeathToReady.push(e.roundNo - p.round);
        pendingReady[pid - 1].splice(i, 1);
      }
    }
    let onBoard = 0;
    for (const row of e.board) for (const u of row) if (u && u.rank === 2 && u.pid === pid) onBoard++;
    cur.r2OnBoardSum += onBoard; cur.r2Samples++;

    if (!player.hand.length) { cur.noDeployTurns++; break; }
    const cell = pickCell(e.board, pid);
    if (!cell) break;
    const type = pickType(e.board, player.hand, pid, cell);
    const have = player.hand.filter(t => t === type).length;

    // 星級決定：有 >=3 張 且 通過 upgradeChance 且 場上沒有己方同兵種二星
    let rank = 1;
    if (have >= 3) {
      const rolled = rnd() < (pid === 1 ? upA : upB);
      if (!rolled) cur.eligibleChoseOne++;
      else if (e.hasRank2(pid, type)) cur.blockedByUnique[type]++;
      else rank = 2;
    }
    if (rank === 2) cur.r2ByType[type]++;

    const before = [];
    for (const row of e.board) for (const u of row) {
      if (u && u.rank === 2) before.push({ id: u.id, pid: u.pid, type: u.type });
    }
    const res = e.deploy(pid, { r: cell[0], c: cell[1], type, rank, turnId: e.turnId });
    if (!res.ok) e.deploy(pid, { r: cell[0], c: cell[1], type, rank: 1, turnId: e.turnId });

    for (const b of before) {
      if (!e.findUnit(b.id)) pendingReady[b.pid - 1].push({ type: b.type, round: e.roundNo });
    }

    for (; seen < e.cleaveLog.length; seen++) {
      const cl = e.cleaveLog[seen], T = S[cl.pid - 1];
      T.cleaves++; T.delta.push(cl.afterMax - cl.beforeMax);
      if (cl.afterRunAtNew >= 5) T.formed5++;
      else if (cl.afterRunAtNew >= 4) T.formed4++;
      else if (cl.afterRunAtNew >= 3) T.formed3++;
      if (cl.beforeRunAtOld >= 4 && cl.afterMax < cl.beforeMax) T.broke4++;
      else if (cl.beforeRunAtOld === 3 && cl.afterMax < cl.beforeMax) T.broke3++;
      if (cl.diedSameResolution) T.diedSame++;
      else watch.set(cl.swordId, { combatCount: cl.combatCount, pid: cl.pid });
      // 斬入「造成」勝利 = 斬入前無五連 + 新位置落在五連上 + 撐到結算結束 + 該玩家確實贏
      if (cl.cleaveFormedFive && cl.fiveFinal && e.gameOver && e.winner === cl.pid) T.cleaveWin++;
    }
    // 用 combatResolutionCount 判斷「下一次戰鬥結算」，不用 roundNo
    for (const [id, info] of [...watch]) {
      if (e.combatResolutionCount > info.combatCount) {
        if (e.findUnit(id)) S[info.pid - 1].survivedNextCombat++;
        else S[info.pid - 1].diedNextCombat++;
        watch.delete(id);
      }
    }
  }
  for (const pid of [1, 2]) for (const t of TYPE_LIST) {
    if (lowRunActive[pid - 1][t] !== undefined) S[pid - 1].lowRuns.push(e.roundNo - lowRunActive[pid - 1][t]);
  }
  return { winner: e.winner, rounds: e.roundNo, gameOver: e.gameOver, S };
}

module.exports = { playGame, TYPE_LIST, TEST_DECK, GameEngine2, pickCell, pickType,
  setSeed: v => { seed = v; }, rnd };
