// 「質變型二星」概念驗證。不修改 game_engine.js。
// 主傷害結算完全沿用正式 resolveCombat；只覆寫三處：
//   1. attackTargets —— ★★槍穿透、★★盾不主動攻擊
//   2. resolveCombat 後處理 —— ★★劍收割、★★盾反震
// 二星數值：HP×1.5 / ATK×1。★★★ 不存在。
const { GameEngine, TYPES } = require("../game_engine.js");

const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const COUNTERED_BY = t => Object.keys(COUNTER).find(k => COUNTER[k] === t);
// 與引擎 ORTHOGONAL 同序，收割的方向 tie-break 就用這個固定順序
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;
const counterMult = (atkType, defType) => COUNTER[atkType] !== defType ? 1
  : (atkType === "spear" && defType === "shield" ? 1.5 : 1.25);


const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
function maxContiguous(board, pid) {
  let best = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (board[r][c]?.pid !== pid) continue;
    for (const [dr, dc] of LINE_DIRS) {
      let n = 0;
      for (let rr = r, cc = c; inB(rr, cc) && board[rr][cc]?.pid === pid; rr += dr, cc += dc) n++;
      best = Math.max(best, n);
    }
  }
  return best;
}
function runThrough(board, pid, r, c) {
  if (board[r][c]?.pid !== pid) return 0;
  let best = 1;
  for (const [dr, dc] of LINE_DIRS) {
    let n = 1;
    for (let rr = r + dr, cc = c + dc; inB(rr, cc) && board[rr][cc]?.pid === pid; rr += dr, cc += dc) n++;
    for (let rr = r - dr, cc = c - dc; inB(rr, cc) && board[rr][cc]?.pid === pid; rr -= dr, cc -= dc) n++;
    best = Math.max(best, n);
  }
  return best;
}
function hasFive(board, pid) { return maxContiguous(board, pid) >= 5; }

let nextId = 1;
function unit(pid, type, rank) {
  const base = TYPES[type];
  const hp = rank === 2 ? Math.round(base.hp * 1.5) : base.hp;
  const atk = rank === 2 ? base.atk : base.atk;      // ATK×1
  return { id: nextId++, pid, type, rank, cards: rank === 2 ? 3 : 1, hp, maxHp: hp, atk, baseAtk: atk };
}

class ConceptEngine extends GameEngine {
  constructor(opts) { super(opts); this.reflectRatio = opts.reflectRatio ?? 0.33; this.trace = []; this.cleaveLog = []; }

  attackTargets(r, c, u) {
    if (u.rank === 2 && u.type === "shield") return [];              // 反震護衛：不主動攻擊
    if (u.rank === 2 && u.type === "spear") {                        // 穿透：第一格不再阻擋第二格
      const out = [];
      for (const [dr, dc] of ORTHO) for (let d = 1; d <= 2; d++) {
        const rr = r + dr * d, cc = c + dc * d;
        if (!inB(rr, cc)) break;
        const t = this.board[rr][cc];
        if (t && t.pid !== u.pid) out.push([rr, cc, d]);              // 友軍不受傷但也不擋
      }
      return out;
    }
    return super.attackTargets(r, c, u);
  }

  // ★★槍：把 ATK 先乘上 (目標數 / 方向數)，引擎的 total/targets.length 會算回 atk/方向數。
  // 這樣不必重寫傷害結算，就得到「按有效攻擊方向分攤、第二格再 ×50%」的效果。
  // ★1 槍每方向至多 1 個目標，係數恆為 1，行為不變。
  patchSpearSplit() {
    const patched = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const u = this.board[r][c];
      if (!u || u.type !== "spear" || u.rank !== 2) continue;
      const targets = this.attackTargets(r, c, u);
      if (!targets.length) continue;
      const dirs = new Set(targets.map(([tr, tc]) => `${Math.sign(tr - r)},${Math.sign(tc - c)}`));
      if (dirs.size === targets.length) continue;
      patched.push([u, u.atk]);
      u.atk = u.atk * targets.length / dirs.size;
    }
    return patched;
  }

  resolveCombat() {
    // 結算順序（依設計定案）：主戰鬥 → 斬入 → 第二刀 → 護衛 → 反震 → 死亡清除
    // 每個階段結束都會清除死亡單位；已死亡的單位不再發動任何能力。
    const spearPatch = this.patchSpearSplit();
    const result = super.resolveCombat();                       // 階段 1：正式主結算（含 removeDead）
    for (const [u, atk] of spearPatch) u.atk = atk;

    // 盾在本次結算中「實際承受的傷害」與來源，跨階段累計
    const shieldTaken = new Map();                              // shieldId -> Map(sourceId -> amount)
    const note = (shieldId, srcId, amount) => {
      if (!shieldTaken.has(shieldId)) shieldTaken.set(shieldId, new Map());
      const m = shieldTaken.get(shieldId);
      m.set(srcId, (m.get(srcId) || 0) + amount);
    };
    for (const row of this.board) for (const guard of row) {
      if (!guard || guard.rank !== 2 || guard.type !== "shield") continue;
      const taken = result.damage.find(d => d.unitId === guard.id);
      if (!taken || taken.damage <= 0) continue;
      const raw = new Map();
      for (const p of result.packets) {
        const direct = p.to.unitId === guard.id;
        const guardedFor = result.guards[`${p.to.r},${p.to.c}`];
        const viaGuard = guardedFor && guardedFor.some(g => g.unitId === guard.id);
        if (!direct && !viaGuard) continue;
        raw.set(p.from.unitId, (raw.get(p.from.unitId) || 0) + (direct ? p.amount : p.amount * 0.5 / guardedFor.length));
      }
      const total = [...raw.values()].reduce((s2, v) => s2 + v, 0);
      if (total <= 0) continue;
      for (const [srcId, share] of raw) note(guard.id, srcId, taken.damage * share / total);
    }

    // --- 階段 2：★★劍 斬入＋第二刀 ---
    const secondStrikes = [];
    for (let sr = 0; sr < 9; sr++) for (let sc = 0; sc < 9; sc++) {
      const sword = this.board[sr][sc];
      if (!sword || sword.rank !== 2 || sword.type !== "sword") continue;
      const killedByMe = result.deaths.filter(d => {
        if (d.cause !== "combat" || d.unit.pid === sword.pid) return false;
        const contrib = new Map();
        for (const p of result.packets) {
          if (p.to.unitId !== d.unit.id) continue;
          contrib.set(p.from.unitId, (contrib.get(p.from.unitId) || 0) + p.amount);
        }
        if (!contrib.has(sword.id)) return false;
        return contrib.get(sword.id) === Math.max(...contrib.values());
      });
      if (!killedByMe.length) continue;
      let dest = null;
      for (const [dr, dc] of ORTHO) {                            // 多重擊殺：固定方向序（下上右左）
        const rr = sr + dr, cc = sc + dc;
        if (killedByMe.some(d => d.r === rr && d.c === cc) && !this.board[rr][cc]) { dest = [rr, cc]; break; }
      }
      if (!dest) continue;
      const beforeMax = maxContiguous(this.board, sword.pid);
      const beforeRunAtOld = runThrough(this.board, sword.pid, sr, sc);
      const fiveBeforeCleave = this.fiveLines(sword.pid).length > 0;
      this.board[sr][sc] = null;
      this.board[dest[0]][dest[1]] = sword;
      const afterMax = maxContiguous(this.board, sword.pid);
      const afterRunAtNew = runThrough(this.board, sword.pid, dest[0], dest[1]);
      const foes = [];
      for (const [dr, dc] of ORTHO) {
        const rr = dest[0] + dr, cc = dest[1] + dc;
        const t = inB(rr, cc) && this.board[rr][cc];
        if (t && t.pid !== sword.pid) foes.push([rr, cc, t]);
      }
      let hit = null;
      if (foes.length) {
        foes.sort((a, b) => a[2].hp - b[2].hp);
        const [tr, tc, target] = foes[0];
        const amount = sword.baseAtk * counterMult(sword.type, target.type);
        secondStrikes.push({ r: tr, c: tc, amount, targetId: target.id, swordId: sword.id });
        hit = { to: `${tr},${tc}`, amount: +amount.toFixed(1), targetType: target.type };
      }
      this.cleaveLog.push({
        swordId: sword.id, pid: sword.pid, from: `${sr},${sc}`, to: `${dest[0]},${dest[1]}`,
        beforeMax, afterMax, beforeRunAtOld, afterRunAtNew, foesAfter: foes.length, hit,
        fiveBeforeCleave,
        fiveAfterCleave: this.fiveLines(sword.pid).length > 0,
        // 斬入「造成」五連 ＝ 斬入前沒有五連，且新位置本身就落在一條五連上
        cleaveFormedFive: !fiveBeforeCleave && afterRunAtNew >= 5,
        combatCount: this.combatResolutionCount,
      });
    }
    for (const st of secondStrikes) {
      const target = this.board[st.r][st.c];
      if (!target || target.id !== st.targetId) continue;
      const dealt = Math.min(Math.max(0, target.hp), Math.round(st.amount));
      target.hp -= Math.round(st.amount);
      this.trace.push({ kind: "cleave-hit", from: st.swordId, to: `${st.r},${st.c}`, amount: Math.round(st.amount) });
      if (target.rank === 2 && target.type === "shield" && dealt > 0) note(target.id, st.swordId, dealt);
    }
    const cleaveDeaths = [];
    this.removeDead("combat", cleaveDeaths);                     // 第二刀造成的死亡：不再觸發斬入
    result.deaths.push(...cleaveDeaths);

    // --- 階段 3：★★盾 反震（來源含主結算與第二刀；已陣亡的盾不反震，反震不再觸發反震）---
    const reflectDamage = new Map();
    for (const [shieldId, sources] of shieldTaken) {
      const spos = this.findUnit(shieldId);
      if (!spos) continue;
      for (const [srcId, amount] of sources) {
        const pos = this.findUnit(srcId);
        if (!pos) continue;
        const key = `${pos[0]},${pos[1]}`;
        reflectDamage.set(key, (reflectDamage.get(key) || 0) + amount * this.reflectRatio);
        this.trace.push({ kind: "reflect", from: shieldId, to: key, amount: +(amount * this.reflectRatio).toFixed(1) });
      }
    }
    for (const [key, amount] of reflectDamage) {
      const [r, c] = key.split(",").map(Number);
      if (this.board[r][c]) this.board[r][c].hp -= Math.round(amount);
    }
    const reflectDeaths = [];
    this.removeDead("combat", reflectDeaths);
    result.deaths.push(...reflectDeaths);
    for (const log of this.cleaveLog) {
      if (log.resolved) continue;
      log.resolved = true;
      log.diedSameResolution = !this.findUnit(log.swordId);
      log.fiveFinal = this.fiveLines(log.pid).length > 0;
      log.round = this.roundNo;
    }
    result.extraTriggers = this.trace.length;
    return result;
  }

  findUnit(id) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (this.board[r][c]?.id === id) return [r, c];
    return null;
  }
}

function setup(spec, reflectRatio) {
  const e = new ConceptEngine({ reflectRatio });
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) e.board[r][c] = null;
  for (const [r, c, pid, type, rank, hp] of spec) {
    const u = unit(pid, type, rank);
    if (hp !== undefined) u.hp = hp;
    e.board[r][c] = u;
  }
  return e;
}

function play(e, maxTicks = 30) {
  const before = new Set();
  for (const row of e.board) for (const u of row) if (u) before.add(u.id);
  let ticks = 0, triggers = 0;
  const perTick = [];
  for (; ticks < maxTicks; ticks++) {
    const t0 = e.trace.length;
    e.resolveCombat();
    perTick.push(e.trace.length - t0);
    triggers = e.trace.length;
    const alive = { 1: 0, 2: 0 };
    for (const row of e.board) for (const u of row) if (u) alive[u.pid]++;
    if (!alive[1] || !alive[2]) { ticks++; break; }
  }
  const side = { 1: [], 2: [] };
  const aliveIds = new Set();
  for (const row of e.board) for (const u of row) if (u) {
    aliveIds.add(u.id);
    side[u.pid].push(`${"★".repeat(u.rank)}${NAME[u.type]}${Math.max(0, u.hp)}`);
  }
  return { ticks, triggers, perTick, deaths: before.size - aliveIds.size, p1: side[1], p2: side[2] };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[\u4e00-\u9fff\u2605→]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const line = r => w(`${r.ticks} 輪`, 8) + w(`${r.deaths} 顆`, 8) + w(`${r.triggers} 次`, 8)
  + w(r.p1.join(" ") || "全滅", 34) + (r.p2.join(" ") || "全滅");
const head = label => { console.log("\n" + "=".repeat(104)); console.log(label); console.log("=".repeat(104));
  console.log(w("情境", 34) + w("輪數", 8) + w("死亡", 8) + w("觸發", 8) + w("守方剩餘", 34) + "攻方剩餘"); console.log("-".repeat(104)); };
module.exports = { setup, play, unit, w, line, head, ConceptEngine, NAME, COUNTERED_BY };
if (require.main === module) require("./rank2_scenarios.js");
