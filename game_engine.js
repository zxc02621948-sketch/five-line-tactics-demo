const crypto = require("crypto");

const N = 9;
const TYPES = Object.freeze({
  sword: { name: "劍", hp: 120, atk: 24 },
  shield: { name: "盾", hp: 160, atk: 20 },
  spear: { name: "槍", hp: 120, atk: 24 },
});
const COUNTER = Object.freeze({ sword: "spear", spear: "shield", shield: "sword" });
const DECK_TEMPLATE = Object.freeze([
  ...Array(9).fill("sword"),
  ...Array(9).fill("shield"),
  ...Array(7).fill("spear"),
]);
const ORTHOGONAL = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
const FIVE_DIRECTIONS = Object.freeze([[1, 0], [0, 1], [1, 1], [1, -1]]);

function inBounds(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < N && c < N;
}

function baseStats(type, rank) {
  const base = TYPES[type];
  const hpMultiplier = rank === 1 ? 1 : rank === 2 ? 3 : 5;
  const attackMultiplier = rank === 1 ? 1 : rank === 2 ? 2 : 3;
  return { maxHp: base.hp * hpMultiplier, atk: base.atk * attackMultiplier };
}

function cardCost(rank) {
  return rank === 1 ? 1 : rank === 2 ? 3 : rank === 3 ? 5 : 0;
}

function counterBonus(attacker, defender) {
  if (COUNTER[attacker.type] !== defender.type) return 0;
  return attacker.type === "spear" && defender.type === "shield" ? 0.5 : 0.25;
}

class GameEngine {
  constructor({ matchId, roomCode, randomInt } = {}) {
    this.matchId = matchId || crypto.randomUUID();
    this.roomCode = roomCode || "TEST00";
    this.randomInt = randomInt || (max => crypto.randomInt(max));
    this.board = Array.from({ length: N }, () => Array(N).fill(null));
    this.players = [this.newPlayer(1), this.newPlayer(2)];
    this.current = 1;
    this.turnId = 1;
    this.roundNo = 1;
    this.actionsThisRound = 0;
    this.artilleryUsedThisTurn = false;
    this.deploymentCommitted = false;
    this.gameOver = false;
    this.winner = null;
    this.nextUnitId = 1;
    this.combatResolutionCount = 0;
    this.logs = [];
    this.artilleryEvents = [];
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.roundRecords = [];
    this.cardConservationAudits = [];
    this.drawToFive(1);
    this.drawToFive(2);
    this.ensureRoundRecord();
    this.addLog("sys", "遊戲開始。第一輪由 P1 先行；每輪完成雙方部署後由伺服器同步結算戰鬥。");
    this.auditCardConservation("game_start");
  }

  newPlayer(id) {
    return {
      id,
      deck: this.shuffle(DECK_TEMPLATE),
      hand: [],
      cooldown: [],
      artillery: 2,
    };
  }

  shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  addLog(kind, text, data = null) {
    this.logs.push({ index: this.logs.length + 1, round: this.roundNo, kind, text, data });
  }

  ensureRoundRecord() {
    let record = this.roundRecords.find(item => item.round === this.roundNo);
    if (!record) {
      record = {
        round: this.roundNo,
        firstPlayer: this.roundNo % 2 === 1 ? 1 : 2,
        actions: [],
        combat: null,
      };
      this.roundRecords.push(record);
    }
    return record;
  }

  drawToFive(pid) {
    const player = this.players[pid - 1];
    while (player.hand.length < 5 && player.deck.length) player.hand.push(player.deck.pop());
  }

  ownerTurnStart(pid) {
    const player = this.players[pid - 1];
    const remaining = [];
    for (const item of player.cooldown) {
      item.turns--;
      if (item.turns <= 0) player.deck.push(item.type);
      else remaining.push(item);
    }
    player.cooldown = remaining;
    player.deck = this.shuffle(player.deck);
    this.drawToFive(pid);
  }

  consumeCards(pid, type, count) {
    const hand = this.players[pid - 1].hand;
    if (hand.filter(card => card === type).length < count) return false;
    let left = count;
    for (let i = hand.length - 1; i >= 0 && left; i--) {
      if (hand[i] === type) {
        hand.splice(i, 1);
        left--;
      }
    }
    return left === 0;
  }

  cardDistribution(pid) {
    const player = this.players[pid - 1];
    const boardBoundCards = this.board
      .flat()
      .filter(unit => unit?.pid === pid)
      .reduce((sum, unit) => sum + unit.cards, 0);
    const distribution = {
      deck: player.deck.length,
      hand: player.hand.length,
      cooldown: player.cooldown.length,
      boardBoundCards,
    };
    distribution.total = distribution.deck + distribution.hand + distribution.cooldown + distribution.boardBoundCards;
    distribution.valid = distribution.total === DECK_TEMPLATE.length;
    return distribution;
  }

  cardConservationSnapshot(context = "snapshot") {
    const players = { P1: this.cardDistribution(1), P2: this.cardDistribution(2) };
    return {
      context,
      round: this.roundNo,
      turnId: this.turnId,
      players,
      valid: players.P1.valid && players.P2.valid,
    };
  }

  auditCardConservation(context) {
    const snapshot = this.cardConservationSnapshot(context);
    this.cardConservationAudits.push(snapshot);
    return snapshot;
  }

  validateActor(pid, turnId) {
    if (this.gameOver) return "本局已結束";
    if (pid !== 1 && pid !== 2) return "無效玩家";
    if (!Number.isInteger(turnId) || turnId !== this.turnId) return "操作已過期；本回合正常行動已完成";
    if (pid !== this.current) return "現在不是你的回合";
    return null;
  }

  deploy(pid, { r, c, type, rank, turnId }) {
    const actorError = this.validateActor(pid, turnId);
    if (actorError) return { ok: false, error: actorError };
    if (this.deploymentCommitted) return { ok: false, error: "本回合已完成部署" };
    if (!inBounds(r, c)) return { ok: false, error: "部署位置超出棋盤" };
    if (this.board[r][c]) return { ok: false, error: "該棋格已有單位" };
    if (!Object.hasOwn(TYPES, type)) return { ok: false, error: "不存在的兵種" };
    const cost = cardCost(rank);
    if (!cost) return { ok: false, error: "無效星級" };
    if (this.players[pid - 1].hand.filter(card => card === type).length < cost) {
      return { ok: false, error: "手牌中沒有足夠的指定兵種" };
    }
    if (!this.consumeCards(pid, type, cost)) return { ok: false, error: "手牌驗證失敗" };

    const stats = baseStats(type, rank);
    const unit = {
      id: this.nextUnitId++, pid, type, rank, cards: cost,
      hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk,
    };
    this.board[r][c] = unit;
    this.deploymentCommitted = true;
    const action = { kind: "deploy", pid, r, c, type, rank, cards: cost };
    this.ensureRoundRecord().actions.push(action);
    this.addLog(pid === 1 ? "r" : "b", `P${pid} 在 (${r + 1},${c + 1}) 部署 ${"★".repeat(rank)}${TYPES[type].name}`, action);
    const transition = this.finishDeployment();
    this.auditCardConservation(`deploy_p${pid}`);
    return { ok: true, action, transition };
  }

  artillery(pid, { r, c, turnId }) {
    const actorError = this.validateActor(pid, turnId);
    if (actorError) return { ok: false, error: actorError };
    if (this.deploymentCommitted) return { ok: false, error: "炮擊只能在部署前使用" };
    if (this.artilleryUsedThisTurn) return { ok: false, error: "同一回合最多使用一次炮擊" };
    if (!inBounds(r, c)) return { ok: false, error: "炮擊位置超出棋盤" };
    const player = this.players[pid - 1];
    if (player.artillery <= 0) return { ok: false, error: "本場炮擊已用完" };
    if (!player.hand.length || !this.hasEmptyCell()) {
      return { ok: false, error: "炮擊後必須能完成正常部署" };
    }

    const enemyPid = pid === 1 ? 2 : 1;
    const threatsBefore = this.threatWindows(enemyPid);
    const ammoBefore = this.players.map(item => item.artillery);
    let enemyHits = 0;
    let friendlyHits = 0;
    const kills = [];
    player.artillery--;
    this.artilleryUsedThisTurn = true;

    for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
      if (!inBounds(rr, cc) || !this.board[rr][cc]) continue;
      const unit = this.board[rr][cc];
      if (unit.pid === pid) friendlyHits++;
      else enemyHits++;
      unit.hp -= rr === r && cc === c ? 30 : 12;
    }
    this.removeDead("artillery", kills);
    const threatsAfter = this.threatWindows(enemyPid);
    const prevented = [...threatsBefore.entries()]
      .filter(([key]) => !threatsAfter.has(key))
      .map(([, threat]) => threat);
    const event = {
      kind: "artillery",
      pid,
      round: this.roundNo,
      r,
      c,
      ammoBefore,
      ammoAfter: this.players.map(item => item.artillery),
      enemyHits,
      friendlyHits,
      kills,
      createdSpaces: kills.length,
      preventedFour: prevented.filter(item => item.kind === 4).length,
      preventedFive: prevented.filter(item => item.kind === 5).length,
      hitTwoOrMoreEnemies: enemyHits >= 2,
      hitFriendly: friendlyHits > 0,
    };
    this.artilleryEvents.push(event);
    this.ensureRoundRecord().actions.push(event);
    this.addLog(pid === 1 ? "r" : "b", `第 ${this.roundNo} 輪 P${pid} 炮擊 (${r + 1},${c + 1})；剩餘 P1 ${this.players[0].artillery}／P2 ${this.players[1].artillery}`, event);
    this.addLog("sys", `炮擊分析：阻止四連 ${event.preventedFour}｜阻止五連 ${event.preventedFive}｜擊殺 ${kills.length}｜新空格 ${event.createdSpaces}｜命中敵軍 ${enemyHits}｜命中友軍 ${friendlyHits}`, event);
    this.auditCardConservation(`artillery_p${pid}`);
    return { ok: true, event };
  }

  hasEmptyCell() {
    return this.board.some(row => row.some(unit => !unit));
  }

  attackTargets(r, c, unit) {
    const result = [];
    if (unit.type === "spear") {
      for (const [dr, dc] of ORTHOGONAL) {
        for (let distance = 1; distance <= 2; distance++) {
          const rr = r + dr * distance, cc = c + dc * distance;
          if (!inBounds(rr, cc)) break;
          const target = this.board[rr][cc];
          if (target) {
            if (target.pid !== unit.pid) result.push([rr, cc, distance]);
            break;
          }
        }
      }
    } else {
      for (const [dr, dc] of ORTHOGONAL) {
        const rr = r + dr, cc = c + dc;
        if (inBounds(rr, cc) && this.board[rr][cc] && this.board[rr][cc].pid !== unit.pid) {
          result.push([rr, cc, 1]);
        }
      }
    }
    return result;
  }

  resolveCombat() {
    this.combatResolutionCount++;
    const packets = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const attacker = this.board[r][c];
      if (!attacker) continue;
      const targets = this.attackTargets(r, c, attacker);
      if (!targets.length) continue;
      let total = attacker.atk;
      if (attacker.type === "sword" && targets.length === 1) total *= 1.5;
      const split = total / targets.length;
      for (const [tr, tc, distance] of targets) {
        const defender = this.board[tr][tc];
        let amount = split;
        if (attacker.type === "spear" && distance === 2) amount *= 0.5;
        amount *= 1 + counterBonus(attacker, defender);
        packets.push({
          from: { r, c, unitId: attacker.id, pid: attacker.pid, type: attacker.type },
          to: { r: tr, c: tc, unitId: defender.id, pid: defender.pid, type: defender.type },
          distance,
          amount,
          counterBonus: counterBonus(attacker, defender),
        });
      }
    }

    const incoming = new Map();
    for (const packet of packets) {
      const key = `${packet.to.r},${packet.to.c}`;
      incoming.set(key, (incoming.get(key) || 0) + packet.amount);
    }
    const finalDamage = new Map(incoming);
    const redirected = new Map();
    const guardsByTarget = new Map();
    for (const [key, amount] of incoming) {
      const [r, c] = key.split(",").map(Number);
      const target = this.board[r][c];
      if (!target || target.type === "shield") continue;
      const guards = [];
      for (const [dr, dc] of ORTHOGONAL) {
        const rr = r + dr, cc = c + dc;
        const guard = inBounds(rr, cc) && this.board[rr][cc];
        if (guard && guard.pid === target.pid && guard.type === "shield") guards.push([rr, cc]);
      }
      if (guards.length) {
        finalDamage.set(key, amount * 0.5);
        guardsByTarget.set(key, guards.map(([gr, gc]) => ({ r: gr, c: gc, unitId: this.board[gr][gc].id })));
        for (const [gr, gc] of guards) {
          const guardKey = `${gr},${gc}`;
          redirected.set(guardKey, (redirected.get(guardKey) || 0) + amount * 0.5 / guards.length);
        }
      }
    }
    for (const [key, amount] of redirected) finalDamage.set(key, (finalDamage.get(key) || 0) + amount);

    const damageResults = [];
    for (const [key, amount] of finalDamage) {
      const [r, c] = key.split(",").map(Number);
      const unit = this.board[r][c];
      if (!unit) continue;
      const damage = Math.round(amount * (unit.type === "shield" ? 0.75 : 1));
      unit.hp -= damage;
      damageResults.push({ r, c, unitId: unit.id, pid: unit.pid, type: unit.type, damage, hpAfter: unit.hp });
    }
    const deaths = [];
    this.removeDead("combat", deaths);
    const result = {
      packets,
      guards: Object.fromEntries(guardsByTarget),
      damage: damageResults,
      deaths,
    };
    this.addLog("sys", packets.length ? `同步戰鬥：${packets.length} 條攻擊關係，由伺服器結算一次。` : "本輪沒有交戰。", result);
    return result;
  }

  removeDead(cause, deaths) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const unit = this.board[r][c];
      if (!unit || unit.hp > 0) continue;
      const death = { cause, r, c, unit: { ...unit } };
      deaths.push(death);
      for (let i = 0; i < unit.cards; i++) {
        this.players[unit.pid - 1].cooldown.push({ type: unit.type, turns: 3 });
      }
      this.board[r][c] = null;
      this.addLog("kill", `${cause === "artillery" ? "炮擊" : "戰鬥"}擊破 P${unit.pid} ${"★".repeat(unit.rank)}${TYPES[unit.type].name}`, death);
    }
  }

  threatWindows(pid) {
    const threats = new Map();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      for (const [dr, dc] of FIVE_DIRECTIONS) {
        const cells = [];
        for (let k = 0; k < 5; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (!inBounds(rr, cc)) { cells.length = 0; break; }
          cells.push([rr, cc]);
        }
        if (!cells.length) continue;
        let own = 0, enemy = 0, empty = 0;
        for (const [rr, cc] of cells) {
          const unit = this.board[rr][cc];
          if (!unit) empty++;
          else if (unit.pid === pid) own++;
          else enemy++;
        }
        if (enemy === 0 && ((own === 4 && empty === 1) || (own === 5 && empty === 0))) {
          threats.set(cells.map(([rr, cc]) => `${rr},${cc}`).join("|"), { kind: own === 5 ? 5 : 4, cells });
        }
      }
    }
    return threats;
  }

  fiveLines(pid) {
    const lines = [];
    const seen = new Set();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.board[r][c]?.pid !== pid) continue;
      for (const [dr, dc] of FIVE_DIRECTIONS) {
        const cells = [];
        for (let k = 0; k < 5; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (!inBounds(rr, cc) || this.board[rr][cc]?.pid !== pid) { cells.length = 0; break; }
          cells.push({ r: rr, c: cc, unitId: this.board[rr][cc].id });
        }
        if (!cells.length) continue;
        const key = cells.map(cell => `${cell.r},${cell.c}`).join("|");
        if (!seen.has(key)) { seen.add(key); lines.push(cells); }
      }
    }
    return lines;
  }

  finishDeployment() {
    this.actionsThisRound++;
    // A normal action consumes its server-issued turn ticket immediately. This
    // also protects round boundaries where the same player acts again first.
    this.turnId++;
    if (this.actionsThisRound < 2) {
      this.current = this.current === 1 ? 2 : 1;
      this.artilleryUsedThisTurn = false;
      this.deploymentCommitted = false;
      this.ownerTurnStart(this.current);
      this.addLog("sys", `第 ${this.roundNo} 輪換 P${this.current} 行動。`);
      return { roundResolved: false };
    }

    const combat = this.resolveCombat();
    this.ensureRoundRecord().combat = combat;
    const p1Lines = this.fiveLines(1);
    const p2Lines = this.fiveLines(2);
    if (p1Lines.length || p2Lines.length) {
      this.gameOver = true;
      this.winner = p1Lines.length && p2Lines.length ? "draw" : p1Lines.length ? 1 : 2;
      this.endedAt = new Date().toISOString();
      this.finalFive = { p1: p1Lines, p2: p2Lines };
      this.addLog("winner", this.winner === "draw" ? "雙方同時五連：平手" : `P${this.winner} 五連獲勝！`, this.finalFive);
      return { roundResolved: true, gameOver: true, winner: this.winner };
    }

    this.roundNo++;
    this.actionsThisRound = 0;
    this.current = this.roundNo % 2 === 1 ? 1 : 2;
    this.artilleryUsedThisTurn = false;
    this.deploymentCommitted = false;
    this.ownerTurnStart(this.current);
    this.ensureRoundRecord();
    this.addLog("sys", `第 ${this.roundNo} 輪開始：P${this.current} 先行。`);
    return { roundResolved: true, gameOver: false };
  }

  visibleStateFor(pid) {
    const own = this.players[pid - 1];
    const opponent = this.players[pid === 1 ? 1 : 0];
    return {
      matchId: this.matchId,
      roomCode: this.roomCode,
      selfPid: pid,
      board: this.board.map(row => row.map(unit => unit ? {
        id: unit.id, pid: unit.pid, type: unit.type, rank: unit.rank,
        hp: unit.hp, maxHp: unit.maxHp, atk: unit.atk,
      } : null)),
      own: {
        hand: [...own.hand],
        deckCount: own.deck.length,
        cooldown: own.cooldown.map(item => ({ ...item })),
      },
      opponent: {
        handCount: opponent.hand.length,
        deckCount: opponent.deck.length,
        cooldownCount: opponent.cooldown.length,
      },
      artillery: { 1: this.players[0].artillery, 2: this.players[1].artillery },
      cardDistribution: { P1: this.cardDistribution(1), P2: this.cardDistribution(2) },
      roundNo: this.roundNo,
      current: this.current,
      turnId: this.turnId,
      firstPlayer: this.roundNo % 2 === 1 ? 1 : 2,
      actionsThisRound: this.actionsThisRound,
      artilleryUsedThisTurn: this.artilleryUsedThisTurn,
      deploymentCommitted: this.deploymentCommitted,
      gameOver: this.gameOver,
      winner: this.winner,
      logs: this.logs.map(({ index, round, kind, text }) => ({ index, round, kind, text })),
      finalFive: this.gameOver ? this.finalFive : null,
    };
  }

  fullMatchReport() {
    return {
      schemaVersion: 1,
      matchId: this.matchId,
      roomCode: this.roomCode,
      players: { P1: "P1", P2: "P2" },
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      firstRoundFirstPlayer: 1,
      rules: {
        board: "9x9",
        deck: { sword: 9, shield: 9, spear: 7 },
        artilleryPerPlayer: 2,
        artilleryDamage: { center: 30, outer: 12, friendlyFire: true },
        rank2: { cards: 3, hpMultiplier: 3, attackMultiplier: 2 },
        rank3: { cards: 5, hpMultiplier: 5, attackMultiplier: 3 },
      },
      rounds: this.roundRecords,
      artilleryAnalysis: this.artilleryEvents,
      finalFive: this.finalFive || { p1: [], p2: [] },
      winner: this.winner,
      finalRound: this.roundNo,
      combatResolutionCount: this.combatResolutionCount,
      remainingArtillery: { P1: this.players[0].artillery, P2: this.players[1].artillery },
      finalCardDistribution: { P1: this.cardDistribution(1), P2: this.cardDistribution(2) },
      cardConservationAudits: this.cardConservationAudits,
      finalBoard: this.board,
      publicLogs: this.logs,
    };
  }
}

module.exports = {
  GameEngine,
  TYPES,
  DECK_TEMPLATE,
  baseStats,
  cardCost,
};
