// 同一份規則同時給 Node（server 權威模式）與瀏覽器（/local 單機）使用。
// 只做模組邊界的相容處理，規則邏輯完全共用。
const nodeCrypto = (() => {
  if (typeof require !== "function") return null;
  try { return require("crypto"); } catch { return null; }
})();
const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : null;
const randomUUID = () => {
  if (nodeCrypto && nodeCrypto.randomUUID) return nodeCrypto.randomUUID();
  if (webCrypto && webCrypto.randomUUID) return webCrypto.randomUUID();
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
const randomBelow = max => {
  if (nodeCrypto && nodeCrypto.randomInt) return nodeCrypto.randomInt(max);
  if (webCrypto && webCrypto.getRandomValues) {
    const limit = Math.floor(0x100000000 / max) * max;      // 拒絕取樣，避免模數偏差
    const buffer = new Uint32Array(1);
    let value;
    do { webCrypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
    return value % max;
  }
  return Math.floor(Math.random() * max);
};

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
// 消極對局：雙方連續 N 輪零交戰＝棄賽，雙敗。「兩邊都不打」才算，
// 單方閃避不算——那本來就會因為沒擋線而輸得更快。
const PASSIVITY_FORFEIT_ROUNDS = 3;
// 加賽：同輪雙方五連不判平手，改為進入加賽，只有單方五連才判勝。
// 緩衝輪數過後每輪全盤扣 maxHP 的固定比例。基準必須是 maxHp——
// 用當前 HP 是指數衰減，永遠殺不死單位，加賽不會結束。
const OVERTIME_RULES = Object.freeze({ graceRounds: 3, decayRate: 0.10, decayBasis: "maxHp" });
// 手牌用完時的唯一出路：把自己的一顆棋往正交相鄰的空格移動一格。
// 這不是通用移動系統——有牌可以部署時不能移動。
const MOVE_RULES = Object.freeze({ range: 1, orthogonalOnly: true, onlyWhenCannotDeploy: true });
// 專案擁有者定案：每回合 20 秒；斷線 40 秒後判離。秒數只在引擎定義，
// 伺服器與兩個客戶端一律讀 timeoutRules()，避免各端各抄一份。
const TIMEOUT_RULES = Object.freeze({ turnMs: 20_000, disconnectMs: 40_000 });
const ORTHOGONAL = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
const FIVE_DIRECTIONS = Object.freeze([[1, 0], [0, 1], [1, 1], [1, -1]]);

function inBounds(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < N && c < N;
}

// ★★菁英：HP = ★ 的 1.5 倍，ATK = ★ 的 1 倍（不再有通用二星攻擊加成）。
// ★★★ 已停用，baseStats 與 cardCost 都不再承認 rank 3。
function baseStats(type, rank) {
  const base = TYPES[type];
  if (rank !== 1 && rank !== 2) return null;
  const hpMultiplier = rank === 2 ? 1.5 : 1;
  return { maxHp: Math.round(base.hp * hpMultiplier), atk: base.atk };
}

function cardCost(rank) {
  return rank === 1 ? 1 : rank === 2 ? 3 : 0;
}

// 每位玩家、每個兵種同時只能有 1 隻 ★★ 在場（各兵種獨立計算）。
function eliteOnBoard(board, pid, type) {
  for (const row of board) for (const unit of row) {
    if (unit && unit.pid === pid && unit.rank === 2 && unit.type === type) return true;
  }
  return false;
}

// Alpha Core v1 的正式回合順序：每個完整回合固定 P1 → P2 → combat，先行者不交替。
// 交替先行會讓某一方取得「上一輪最後部署 ＋ 下一輪第一部署」的連續兩次部署窗口，
// 那不是正式規則。所有正式入口一律套用這組設定；alternating 只保留給開發測試。
const ALPHA_TURN_ORDER = Object.freeze({ turnOrderMode: "fixed", startingPlayer: 1 });

function counterBonus(attacker, defender) {
  if (COUNTER[attacker.type] !== defender.type) return 0;
  return attacker.type === "spear" && defender.type === "shield" ? 0.5 : 0.25;
}

class GameEngine {
  constructor({ matchId, roomCode, randomInt, turnOrderMode = "alternating", startingPlayer, now } = {}) {
    this.matchId = matchId || randomUUID();
    this.roomCode = roomCode || "TEST00";
    this.randomInt = randomInt || (max => randomBelow(max));
    this.now = typeof now === "function" ? now : () => Date.now();
    this.turnOrderMode = turnOrderMode === "fixed" ? "fixed" : "alternating";
    this.startingPlayer = this.turnOrderMode === "fixed"
      ? (startingPlayer === 1 || startingPlayer === 2 ? startingPlayer : this.randomInt(2) + 1)
      : 1;
    this.board = Array.from({ length: N }, () => Array(N).fill(null));
    this.players = [this.newPlayer(1), this.newPlayer(2)];
    this.current = this.startingPlayer;
    this.turnId = 1;
    this.roundNo = 1;
    this.actionsThisRound = 0;
    this.artilleryUsedThisTurn = false;
    this.deploymentCommitted = false;
    this.turnDeadline = null;
    this.turnClockPausedAt = null;
    this.turnRemainingMs = null;
    this.gameOver = false;
    this.winner = null;
    this.endReason = null;
    this.forfeitedPlayer = null;
    this.overtime = false;
    this.overtimeStartRound = null;
    this.quietRounds = 0;
    this.nextUnitId = 1;
    this.combatResolutionCount = 0;
    this.logs = [];
    this.artilleryEvents = [];
    this.startedAt = new Date(this.now()).toISOString();
    this.endedAt = null;
    this.roundRecords = [];
    this.cardConservationAudits = [];
    this.drawToFive(1);
    this.drawToFive(2);
    this.ensureRoundRecord();
    this.beginTurnClock();
    this.addLog("sys", `遊戲開始。第一輪由 P${this.startingPlayer} 先行；每輪完成雙方回合後由伺服器同步結算戰鬥。`);
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

  firstPlayerForRound(round = this.roundNo) {
    return this.turnOrderMode === "fixed" ? this.startingPlayer : round % 2 === 1 ? 1 : 2;
  }

  ensureRoundRecord() {
    let record = this.roundRecords.find(item => item.round === this.roundNo);
    if (!record) {
      record = {
        round: this.roundNo,
        firstPlayer: this.firstPlayerForRound(),
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

  beginTurnClock(now = this.now()) {
    this.turnDeadline = now + TIMEOUT_RULES.turnMs;
    this.turnClockPausedAt = null;
    this.turnRemainingMs = TIMEOUT_RULES.turnMs;
  }

  pauseTurnClock(now = this.now()) {
    if (this.gameOver || this.turnClockPausedAt !== null) return;
    this.turnRemainingMs = Math.max(0, this.turnDeadline - now);
    this.turnClockPausedAt = now;
  }

  resumeTurnClock(now = this.now()) {
    if (this.gameOver || this.turnClockPausedAt === null) return;
    this.turnDeadline = now + this.turnRemainingMs;
    this.turnClockPausedAt = null;
  }

  turnClockState(now = this.now()) {
    const paused = this.turnClockPausedAt !== null;
    return {
      deadline: paused || this.gameOver ? null : this.turnDeadline,
      paused,
      remainingMs: this.gameOver ? 0 : paused
        ? this.turnRemainingMs
        : Math.max(0, this.turnDeadline - now),
    };
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
    if (!Number.isInteger(turnId) || turnId !== this.turnId) return "操作已過期；本回合已結束";
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
    if (rank !== 1 && rank !== 2) return { ok: false, error: "★★★已停用，只能部署 ★ 或 ★★" };
    const cost = cardCost(rank);
    if (!cost) return { ok: false, error: "無效星級" };
    if (rank === 2 && eliteOnBoard(this.board, pid, type)) {
      return { ok: false, error: `場上已有 ★★${TYPES[type].name}，同兵種同時只能有一隻` };
    }
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
    this.auditCardConservation(`deploy_p${pid}`);
    return { ok: true, action, transition: { roundResolved: false, awaitingEndTurn: true } };
  }

  // 沒牌可放時的替代行動：移動一格。與部署一樣佔掉本回合的行動。
  move(pid, { r, c, toR, toC, turnId }) {
    const actorError = this.validateActor(pid, turnId);
    if (actorError) return { ok: false, error: actorError };
    if (this.deploymentCommitted) return { ok: false, error: "本回合已完成行動" };
    if (this.canDeploy(pid)) return { ok: false, error: "手牌還有可部署的兵，本回合不能改用移動" };
    if (!inBounds(r, c) || !inBounds(toR, toC)) return { ok: false, error: "移動位置超出棋盤" };
    const unit = this.board[r][c];
    if (!unit) return { ok: false, error: "起點沒有單位" };
    if (unit.pid !== pid) return { ok: false, error: "只能移動自己的單位" };
    if (this.board[toR][toC]) return { ok: false, error: "目標格已有單位" };
    if (Math.abs(r - toR) + Math.abs(c - toC) !== MOVE_RULES.range) {
      return { ok: false, error: "一次只能往正交相鄰的空格移動一格" };
    }

    this.board[toR][toC] = unit;
    this.board[r][c] = null;
    this.deploymentCommitted = true;
    const action = { kind: "move", pid, r, c, toR, toC, unitId: unit.id };
    this.ensureRoundRecord().actions.push(action);
    this.addLog(pid === 1 ? "r" : "b",
      `P${pid} 手牌用盡，將 ${"★".repeat(unit.rank)}${TYPES[unit.type].name} 從 (${r + 1},${c + 1}) 移動到 (${toR + 1},${toC + 1})`,
      action);
    this.auditCardConservation(`move_p${pid}`);
    return { ok: true, action, transition: { roundResolved: false, awaitingEndTurn: true } };
  }

  artillery(pid, { r, c, turnId }) {
    const actorError = this.validateActor(pid, turnId);
    if (actorError) return { ok: false, error: actorError };
    if (this.artilleryUsedThisTurn) return { ok: false, error: "同一回合最多使用一次炮擊" };
    if (!inBounds(r, c)) return { ok: false, error: "炮擊位置超出棋盤" };
    const player = this.players[pid - 1];
    if (player.artillery <= 0) return { ok: false, error: "本場炮擊已用完" };
    if (!this.deploymentCommitted && !this.canAct(pid)) {
      return { ok: false, error: "炮擊後必須能完成部署或移動" };
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

  // 部署／移動只提交本回合的主要行動；玩家仍可補一次炮擊，最後明確結束回合。
  // automatic 只供權威逾時機制使用：逾時時即使尚未提交主要行動也必須放行，
  // 否則惡意玩家仍能靠永遠不操作卡住對局。
  endTurn(pid, { turnId, automatic = false } = {}) {
    const actorError = this.validateActor(pid, turnId);
    if (actorError) return { ok: false, error: actorError };
    if (!automatic && !this.deploymentCommitted && this.canAct(pid)) {
      return { ok: false, error: "請先完成部署或移動，再結束回合" };
    }
    if (automatic) this.addLog("sys", `P${pid} 回合逾時，伺服器已自動結束回合。`);
    const transition = this.finishTurn();
    return { ok: true, automatic, transition };
  }

  checkTurnTimeout(now = this.now()) {
    if (this.gameOver || this.turnClockPausedAt !== null || now < this.turnDeadline) return null;
    return this.endTurn(this.current, { turnId: this.turnId, automatic: true });
  }

  forfeit(pid, reason = "disconnect_timeout") {
    if (this.gameOver) return { ok: false, error: "本局已結束" };
    if (pid !== 1 && pid !== 2) return { ok: false, error: "無效玩家" };
    this.gameOver = true;
    this.winner = pid === 1 ? 2 : 1;
    this.endReason = reason;
    this.forfeitedPlayer = pid;
    this.endedAt = new Date(this.now()).toISOString();
    this.finalFive = { p1: [], p2: [] };
    this.turnDeadline = null;
    this.turnClockPausedAt = null;
    this.turnRemainingMs = 0;
    const label = reason === "disconnect_timeout" ? "斷線逾時" : "離場";
    this.addLog("winner", `P${pid} ${label}，P${this.winner} 獲勝。`, { forfeitedPlayer: pid, reason });
    return { ok: true, winner: this.winner, reason };
  }

  hasEmptyCell() {
    return this.board.some(row => row.some(unit => !unit));
  }

  // 有手牌又有空格才算「能部署」。
  canDeploy(pid) {
    return this.players[pid - 1].hand.length > 0 && this.hasEmptyCell();
  }

  // 手牌用完時的合法移動：自己的棋往正交相鄰的空格走一格。
  // 還有牌可以部署時一律回空陣列——移動是沒牌時的替代行動，不是額外行動。
  legalMoves(pid) {
    if (this.canDeploy(pid)) return [];
    const moves = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const unit = this.board[r][c];
      if (!unit || unit.pid !== pid) continue;
      for (const [dr, dc] of ORTHOGONAL) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && !this.board[nr][nc]) moves.push({ from: [r, c], to: [nr, nc] });
      }
    }
    return moves;
  }

  // 這一方本回合有沒有任何合法行動。兩者皆無時自動跳過，不判輸——
  // 牌是守恆的，單位活在場上就等於那張牌不在手上，若判輸等於懲罰守得好的一方。
  canAct(pid) {
    return this.canDeploy(pid) || this.legalMoves(pid).length > 0;
  }

  attackTargets(r, c, unit) {
    const result = [];
    // ★★盾是純防禦型菁英，完全不主動攻擊。
    if (unit.type === "shield" && unit.rank === 2) return result;
    if (unit.type === "spear") {
      for (const [dr, dc] of ORTHOGONAL) {
        for (let distance = 1; distance <= 2; distance++) {
          const rr = r + dr * distance, cc = c + dc * distance;
          if (!inBounds(rr, cc)) break;
          const target = this.board[rr][cc];
          if (target) {
            if (target.pid !== unit.pid) result.push([rr, cc, distance]);
            // ★★槍可穿過第一格（無論敵我），★槍照舊被任何佔用格阻擋。
            if (unit.rank !== 2) break;
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
      // 槍：ATK 只依「存在合法敵方目標的正交方向數」平均分配，同方向多個受擊者不增加分母。
      // 其他兵種維持依目標數平分。
      const denominator = attacker.type === "spear"
        ? new Set(targets.map(([tr, tc]) => `${Math.sign(tr - r)},${Math.sign(tc - c)}`)).size
        : targets.length;
      const split = total / denominator;
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

    // ---- 護衛轉移：非盾友軍受傷時，50% 轉給正交相鄰的盾（多盾分攤，總轉移不超過 50%）----
    const incoming = new Map();
    const rawSources = new Map();                 // cellKey -> Map(sourceUnitId -> 原始傷害)
    const addSource = (key, sourceId, value) => {
      if (!rawSources.has(key)) rawSources.set(key, new Map());
      const m = rawSources.get(key);
      m.set(sourceId, (m.get(sourceId) || 0) + value);
    };
    for (const packet of packets) {
      const key = `${packet.to.r},${packet.to.c}`;
      incoming.set(key, (incoming.get(key) || 0) + packet.amount);
      addSource(key, packet.from.unitId, packet.amount);
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
        const sources = rawSources.get(key) || new Map();
        for (const [gr, gc] of guards) {
          const guardKey = `${gr},${gc}`;
          redirected.set(guardKey, (redirected.get(guardKey) || 0) + amount * 0.5 / guards.length);
          // 轉移到盾身上的那一份，來源仍記在原攻擊者頭上（供反震歸因）
          for (const [srcId, value] of sources) addSource(guardKey, srcId, value * 0.5 / guards.length);
        }
        // 被護衛者身上只留下一半，來源份額同步減半
        for (const [srcId, value] of sources) sources.set(srcId, value * 0.5);
      }
    }
    for (const [key, amount] of redirected) finalDamage.set(key, (finalDamage.get(key) || 0) + amount);

    // ---- 套用主戰鬥傷害。反震以「盾真正扣掉的 HP」為準，不計 overkill ----
    const damageResults = [];
    const reflectLedger = new Map();               // ★★盾 unitId -> Map(sourceUnitId -> 實際承受傷害)
    const noteReflect = (shieldId, sourceId, value) => {
      if (value <= 0) return;
      if (!reflectLedger.has(shieldId)) reflectLedger.set(shieldId, new Map());
      const m = reflectLedger.get(shieldId);
      m.set(sourceId, (m.get(sourceId) || 0) + value);
    };
    const applyDamage = (unit, rawAmount, sources) => {
      const damage = Math.round(rawAmount);
      const actual = Math.min(Math.max(0, unit.hp), damage);
      unit.hp -= damage;
      if (unit.type === "shield" && unit.rank === 2 && actual > 0 && sources && sources.size) {
        const total = [...sources.values()].reduce((sum, v) => sum + v, 0);
        if (total > 0) for (const [srcId, value] of sources) noteReflect(unit.id, srcId, actual * value / total);
      }
      return { damage, actual };
    };
    const hpBefore = new Map();                    // unitId -> 本次結算前的 HP
    for (const [key, amount] of finalDamage) {
      const [r, c] = key.split(",").map(Number);
      const unit = this.board[r][c];
      if (!unit) continue;
      hpBefore.set(unit.id, unit.hp);
      // 盾的耐久只由高 HP 表現，不再額外減傷。
      const { damage, actual } = applyDamage(unit, amount, rawSources.get(key));
      damageResults.push({ r, c, unitId: unit.id, pid: unit.pid, type: unit.type, damage, actualDamage: actual, hpAfter: unit.hp });
    }
    const deaths = [];
    this.removeDead("combat", deaths, "main");

    // ---- 階段 2：★★劍 斬入 ＋ 追擊 ----
    const cleaves = this.resolveCleaves(deaths, applyDamage, rawSources, hpBefore);
    if (cleaves.length) this.removeDead("combat", deaths, "cleave");

    // ---- 階段 3：★★盾 100% 反震（不再觸發反震、不再觸發護衛）----
    const reflections = [];
    // ★★盾即使因本次主戰鬥陣亡，已記錄的實際承傷仍照常反震（不丟棄 ledger）。
    const damagePositionByUnit = new Map(damageResults.map(item => [item.unitId, { r: item.r, c: item.c }]));
    for (const [shieldId, sources] of reflectLedger) {
      for (const [srcId, value] of sources) {
        const pos = this.findUnitById(srcId);
        if (!pos) continue;
        const attacker = this.board[pos[0]][pos[1]];
        const damage = Math.round(value);
        if (damage <= 0) continue;
        attacker.hp -= damage;
        reflections.push({
          shieldId,
          from: damagePositionByUnit.get(shieldId) || null,
          r: pos[0], c: pos[1], unitId: srcId, damage, hpAfter: attacker.hp,
        });
      }
    }
    if (reflections.length) this.removeDead("combat", deaths, "reflection");

    const result = {
      packets,
      guards: Object.fromEntries(guardsByTarget),
      damage: damageResults,
      cleaves,
      reflections,
      deaths,
    };
    this.addLog("sys", packets.length ? `同步戰鬥：${packets.length} 條攻擊關係，由伺服器結算一次。` : "本輪沒有交戰。", result);
    return result;
  }

  findUnitById(id) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.board[r][c] && this.board[r][c].id === id) return [r, c];
    }
    return null;
  }

  // ★★劍 斬入：主戰鬥中親自擊殺自己的攻擊目標 → 強制移動到死亡格 → 對新位置正交相鄰
  // 敵人中 HP 最低者追擊一次（100% base ATK，套互剋，不套決鬥加成）。
  // 每次結算每隻 ★★劍最多一次；追擊擊殺不得再次斬入；主戰鬥已陣亡者不得斬入。
  resolveCleaves(deaths, applyDamage, rawSources, hpBefore) {
    const log = [];
    for (let sr = 0; sr < N; sr++) for (let sc = 0; sc < N; sc++) {
      const sword = this.board[sr][sc];
      if (!sword || sword.rank !== 2 || sword.type !== "sword") continue;   // 已陣亡者不在盤上
      // 「親自擊殺」＝ ★★劍自己的 main attack 落在該目標上的傷害，單獨就足以把它從
      // 結算前的 HP 打到 0。友軍共同補刀致死不算，即使 ★★劍是最高貢獻者也不觸發。
      const killedByMe = deaths.filter(d => {
        if (d.cause !== "combat" || d.unit.pid === sword.pid) return false;
        const sources = rawSources.get(`${d.r},${d.c}`);
        const own = sources && sources.get(sword.id);
        if (!own) return false;
        const before = hpBefore.get(d.unit.id);
        return before !== undefined && Math.round(own) >= before;
      });
      if (!killedByMe.length) continue;
      let dest = null;
      for (const [dr, dc] of ORTHOGONAL) {          // 多重擊殺時用固定方向順序，維持 deterministic
        const rr = sr + dr, cc = sc + dc;
        if (killedByMe.some(d => d.r === rr && d.c === cc) && !this.board[rr][cc]) { dest = [rr, cc]; break; }
      }
      if (!dest) continue;
      this.board[sr][sc] = null;
      this.board[dest[0]][dest[1]] = sword;
      const foes = [];
      for (const [dr, dc] of ORTHOGONAL) {
        const rr = dest[0] + dr, cc = dest[1] + dc;
        const foe = inBounds(rr, cc) && this.board[rr][cc];
        if (foe && foe.pid !== sword.pid) foes.push([rr, cc, foe]);
      }
      const entry = {
        unitId: sword.id, pid: sword.pid, type: sword.type, rank: sword.rank,
        from: { r: sr, c: sc }, to: { r: dest[0], c: dest[1] }, followUp: null,
      };
      if (foes.length) {
        foes.sort((a, b) => a[2].hp - b[2].hp);     // HP 最低優先，同 HP 用固定方向順序
        const [tr, tc, target] = foes[0];
        const amount = TYPES[sword.type].atk * (1 + counterBonus(sword, target));
        const sources = new Map([[sword.id, amount]]);
        const { damage, actual } = applyDamage(target, amount, sources);
        entry.followUp = { r: tr, c: tc, unitId: target.id, damage, actualDamage: actual, hpAfter: target.hp };
      }
      log.push(entry);
      this.addLog(sword.pid === 1 ? "r" : "b",
        `P${sword.pid} ★★劍 斬入 (${sr + 1},${sc + 1})→(${dest[0] + 1},${dest[1] + 1})`
        + (entry.followUp ? `，追擊 (${entry.followUp.r + 1},${entry.followUp.c + 1}) ${entry.followUp.damage}` : "，無追擊目標"), entry);
    }
    return log;
  }

  removeDead(cause, deaths, phase = cause) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const unit = this.board[r][c];
      if (!unit || unit.hp > 0) continue;
      const death = { cause, phase, r, c, unit: { ...unit } };
      deaths.push(death);
      for (let i = 0; i < unit.cards; i++) {
        this.players[unit.pid - 1].cooldown.push({ type: unit.type, turns: 3 });
      }
      this.board[r][c] = null;
      const causeLabel = cause === "artillery" ? "炮擊" : cause === "overtime" ? "加賽衰減" : "戰鬥";
      this.addLog("kill", `${causeLabel}擊破 P${unit.pid} ${"★".repeat(unit.rank)}${TYPES[unit.type].name}`, death);
    }
  }

  // 加賽衰減：全盤等比例扣血，敵我一視同仁。回傳這輪的扣血明細。
  applyOvertimeDecay() {
    const hits = [];
    const deaths = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const unit = this.board[r][c];
      if (!unit) continue;
      const damage = Math.max(1, Math.round(unit.maxHp * OVERTIME_RULES.decayRate));
      unit.hp -= damage;
      hits.push({ r, c, unitId: unit.id, pid: unit.pid, damage, hpAfter: unit.hp });
    }
    if (hits.length) this.removeDead("overtime", deaths);
    return { hits, deaths };
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

  finishTurn() {
    let result = this.advanceAfterAction();
    // 沒牌可放、又沒有任何合法移動的一方只能跳過。這個迴圈一定會停：
    // 要嘛有交戰（單位陣亡 → 牌經冷卻回流），要嘛雙方連續零交戰而
    // 觸發消極判負。guard 只是防呆，正常不會用到。
    let guard = 0;
    while (!this.gameOver && !this.canAct(this.current) && guard++ < 200) {
      this.addLog("sys", `P${this.current} 沒有手牌、也沒有可移動的棋子：跳過本回合。`);
      result = this.advanceAfterAction();
    }
    return result;
  }

  // 保留給既有平衡腳本的相容入口；正式流程一律呼叫 endTurn()。
  finishDeployment() {
    return this.finishTurn();
  }

  advanceAfterAction() {
    this.actionsThisRound++;
    // A normal action consumes its server-issued turn ticket immediately. This
    // also protects round boundaries where the same player acts again first.
    this.turnId++;
    if (this.actionsThisRound < 2) {
      this.current = this.current === 1 ? 2 : 1;
      this.artilleryUsedThisTurn = false;
      this.deploymentCommitted = false;
      this.ownerTurnStart(this.current);
      this.beginTurnClock();
      this.addLog("sys", `第 ${this.roundNo} 輪換 P${this.current} 行動。`);
      return { roundResolved: false };
    }

    const combat = this.resolveCombat();
    const record = this.ensureRoundRecord();
    record.combat = combat;

    // 消極對局：雙方連續零交戰達門檻＝棄賽，雙敗。先於五連判定，
    // 因為「雙方都沒在打」時這局已經不成立，不該讓任何一方兌現。
    this.quietRounds = combat.packets.length ? 0 : this.quietRounds + 1;
    record.quietRounds = this.quietRounds;
    if (this.quietRounds >= PASSIVITY_FORFEIT_ROUNDS) {
      this.gameOver = true;
      this.winner = "double_loss";
      this.endReason = "passivity_forfeit";
      this.endedAt = new Date(this.now()).toISOString();
      this.turnDeadline = null;
      this.turnClockPausedAt = null;
      this.turnRemainingMs = 0;
      this.finalFive = { p1: [], p2: [] };
      this.addLog("winner", `雙方連續 ${PASSIVITY_FORFEIT_ROUNDS} 輪未交戰：消極對局，雙方棄賽。`,
        { quietRounds: this.quietRounds });
      return { roundResolved: true, gameOver: true, winner: this.winner };
    }

    // 加賽衰減在五連判定之前結算：被衰減打斷的線就不算數。
    if (this.overtime && this.roundNo - this.overtimeStartRound > OVERTIME_RULES.graceRounds) {
      record.overtimeDecay = this.applyOvertimeDecay();
    }

    const p1Lines = this.fiveLines(1);
    const p2Lines = this.fiveLines(2);
    const p1Has = p1Lines.length > 0;
    const p2Has = p2Lines.length > 0;

    if (p1Has !== p2Has) {
      // 恰好單方五連才判勝——加賽階段內外都適用同一條判定。
      this.gameOver = true;
      this.winner = p1Has ? 1 : 2;
      this.endReason = "five_line";
      this.endedAt = new Date(this.now()).toISOString();
      this.turnDeadline = null;
      this.turnClockPausedAt = null;
      this.turnRemainingMs = 0;
      this.finalFive = { p1: p1Lines, p2: p2Lines };
      this.addLog("winner", `P${this.winner} 五連獲勝！${this.overtime ? "（加賽）" : ""}`, this.finalFive);
      return { roundResolved: true, gameOver: true, winner: this.winner };
    }

    if (p1Has && p2Has && !this.overtime) {
      // 同輪雙方五連不判平手，改為進入加賽。
      this.overtime = true;
      this.overtimeStartRound = this.roundNo;
      this.addLog("sys",
        `雙方同輪五連：進入加賽。只有單方五連才判勝；再 ${OVERTIME_RULES.graceRounds} 輪後，`
        + `每輪全盤扣最大生命的 ${Math.round(OVERTIME_RULES.decayRate * 100)}%。`,
        { overtimeStartRound: this.roundNo });
    }

    this.roundNo++;
    this.actionsThisRound = 0;
    this.current = this.firstPlayerForRound();
    this.artilleryUsedThisTurn = false;
    this.deploymentCommitted = false;
    this.ownerTurnStart(this.current);
    this.beginTurnClock();
    this.ensureRoundRecord();
    this.addLog("sys", `第 ${this.roundNo} 輪開始：P${this.current} 先行。`);
    return { roundResolved: true, gameOver: false };
  }

  // 純顯示用的權威資料：UI 直接讀這裡，不要在前端另外抄一份數值。
  static unitCatalog() {
    const catalog = {};
    for (const type of Object.keys(TYPES)) {
      catalog[type] = {
        name: TYPES[type].name,
        counters: COUNTER[type],
        counteredBy: Object.keys(COUNTER).find(key => COUNTER[key] === type),
        ranks: {
          1: baseStats(type, 1),
          2: { ...baseStats(type, 2), attacks: type !== "shield" },
        },
      };
    }
    return catalog;
  }

  // 純顯示用：加賽與消極判負的實際參數，讓 UI 不必自己抄一份數值。
  static overtimeRules() {
    return { ...OVERTIME_RULES, passivityForfeitRounds: PASSIVITY_FORFEIT_ROUNDS };
  }

  // 純顯示用：炮擊的實際參數，讓 UI 不必自己抄一份數值。
  static artilleryRules() {
    return { perPlayer: 2, radius: 1, center: 30, outer: 12, friendlyFire: true };
  }

  // 純顯示用：沒牌時的移動規則，UI 不要自己抄。
  static movementRules() {
    return { ...MOVE_RULES, skipWhenNoLegalMove: true };
  }

  static timeoutRules() {
    return { ...TIMEOUT_RULES };
  }

  // 最近一次戰鬥的純顯示資料。演出只讀引擎已結算的座標、傷害與事件順序，
  // 不讓前端重新計算互剋、護衛、斬入或反震。
  lastCombatPresentation() {
    let record = null;
    for (let i = this.roundRecords.length - 1; i >= 0; i--) {
      if (this.roundRecords[i].combat) { record = this.roundRecords[i]; break; }
    }
    if (!record) return null;
    const combat = record.combat;
    const point = item => ({ r: item.r, c: item.c });
    const actor = item => ({
      ...point(item), unitId: item.unitId, pid: item.pid, type: item.type,
    });
    return {
      id: `${this.matchId}:${record.round}`,
      round: record.round,
      packets: combat.packets.map(packet => ({
        from: actor(packet.from),
        to: actor(packet.to),
      })),
      guards: Object.fromEntries(Object.entries(combat.guards || {}).map(([key, guards]) => [
        key,
        guards.map(guard => ({ ...point(guard), unitId: guard.unitId })),
      ])),
      damage: combat.damage.map(item => ({
        ...point(item), unitId: item.unitId, pid: item.pid, type: item.type,
        damage: item.damage, hpAfter: item.hpAfter,
      })),
      cleaves: combat.cleaves.map(item => ({
        unitId: item.unitId, pid: item.pid, type: item.type, rank: item.rank,
        from: point(item.from), to: point(item.to),
        followUp: item.followUp ? {
          ...point(item.followUp), unitId: item.followUp.unitId,
          damage: item.followUp.damage, hpAfter: item.followUp.hpAfter,
        } : null,
      })),
      reflections: combat.reflections.map(item => ({
        shieldId: item.shieldId,
        from: item.from ? point(item.from) : null,
        ...point(item), unitId: item.unitId, damage: item.damage, hpAfter: item.hpAfter,
      })),
      deaths: combat.deaths.map(item => ({
        cause: item.cause, phase: item.phase, ...point(item),
        unit: {
          id: item.unit.id, pid: item.unit.pid, type: item.unit.type, rank: item.unit.rank,
        },
      })),
    };
  }

  visibleStateFor(pid) {
    const own = this.players[pid - 1];
    const opponent = this.players[pid === 1 ? 1 : 0];
    const turnClock = this.turnClockState();
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
      firstPlayer: this.firstPlayerForRound(),
      startingPlayer: this.startingPlayer,
      turnOrderMode: this.turnOrderMode,
      unitCatalog: GameEngine.unitCatalog(),
      artilleryRules: GameEngine.artilleryRules(),
      movementRules: GameEngine.movementRules(),
      timeoutRules: GameEngine.timeoutRules(),
      eliteCardCost: cardCost(2),
      deathCooldownRounds: 3,
      actionsThisRound: this.actionsThisRound,
      artilleryUsedThisTurn: this.artilleryUsedThisTurn,
      deploymentCommitted: this.deploymentCommitted,
      canAct: !this.gameOver && pid === this.current && !this.deploymentCommitted && this.canAct(pid),
      turnDeadline: turnClock.deadline,
      turnClockPaused: turnClock.paused,
      turnRemainingMs: turnClock.remainingMs,
      gameOver: this.gameOver,
      winner: this.winner,
      endReason: this.endReason,
      forfeitedPlayer: this.forfeitedPlayer || null,
      overtime: this.overtime,
      overtimeRound: this.overtime ? this.roundNo - this.overtimeStartRound : 0,
      overtimeRules: GameEngine.overtimeRules(),
      quietRounds: this.quietRounds,
      passivityForfeitRounds: PASSIVITY_FORFEIT_ROUNDS,
      logs: this.logs.map(({ index, round, kind, text }) => ({ index, round, kind, text })),
      finalFive: this.gameOver ? this.finalFive : null,
      lastCombat: this.lastCombatPresentation(),
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
      firstRoundFirstPlayer: this.startingPlayer,
      rules: {
        board: "9x9",
        turnOrderMode: this.turnOrderMode,
      unitCatalog: GameEngine.unitCatalog(),
      artilleryRules: GameEngine.artilleryRules(),
      timeoutRules: GameEngine.timeoutRules(),
      eliteCardCost: cardCost(2),
      deathCooldownRounds: 3,
        deck: { sword: 9, shield: 9, spear: 7 },
        artilleryPerPlayer: 2,
        artilleryDamage: { center: 30, outer: 12, friendlyFire: true },
        rank2: { cards: 3, hpMultiplier: 1.5, attackMultiplier: 1, maxOnBoardPerType: 1 },
        rank3: "disabled",
        overtime: {
          trigger: "同輪雙方五連",
          win: "只有單方五連才判勝",
          deployDuringOvertime: true,
          ...OVERTIME_RULES,
        },
        passivityForfeit: { quietRounds: PASSIVITY_FORFEIT_ROUNDS, result: "double_loss" },
        noCardsFallback: { ...GameEngine.movementRules(), result: "跳過該回合，不判輸" },
        eliteAbilities: {
          sword: "斬入：親自擊殺目標後強制移入死亡格，對相鄰最低HP敵人追擊 100% base ATK（套互剋、不套決鬥）",
          shield: "不主動攻擊；相鄰非盾友軍 50% 傷害轉移；對自身實際承受傷害 100% 反震",
          spear: "射程 2 可穿透第一格；ATK 依有效攻擊方向數分攤，第二格 50%",
        },
      },
      rounds: this.roundRecords,
      artilleryAnalysis: this.artilleryEvents,
      finalFive: this.finalFive || { p1: [], p2: [] },
      winner: this.winner,
      endReason: this.endReason,
      forfeitedPlayer: this.forfeitedPlayer,
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

const FiveLineEngine = { GameEngine, TYPES, DECK_TEMPLATE, baseStats, cardCost, ALPHA_TURN_ORDER, OVERTIME_RULES, PASSIVITY_FORFEIT_ROUNDS, MOVE_RULES, TIMEOUT_RULES };
if (typeof module !== "undefined" && module.exports) module.exports = FiveLineEngine;
if (typeof globalThis !== "undefined") globalThis.FiveLineEngine = FiveLineEngine;
