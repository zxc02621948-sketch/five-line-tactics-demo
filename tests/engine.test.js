const test = require("node:test");
const assert = require("node:assert/strict");
const { GameEngine, baseStats } = require("../game_engine");

function game() {
  return new GameEngine({ matchId: "test-match", roomCode: "ABC123", randomInt: () => 0 });
}

function intent(engine, fields) {
  return { ...fields, turnId: engine.turnId };
}

function endTurn(engine, pid = engine.current) {
  return engine.endTurn(pid, intent(engine, {}));
}

test("visible state contains only the requesting player's hand", () => {
  const engine = game();
  engine.players[0].hand = ["sword", "shield"];
  engine.players[1].hand = ["spear", "spear", "shield"];
  const p1 = engine.visibleStateFor(1);
  const p2 = engine.visibleStateFor(2);
  assert.deepEqual(p1.own.hand, ["sword", "shield"]);
  assert.equal(p1.opponent.handCount, 3);
  assert.equal(Object.hasOwn(p1.opponent, "hand"), false);
  assert.deepEqual(p2.own.hand, ["spear", "spear", "shield"]);
  assert.equal(p2.opponent.handCount, 2);
  assert.equal(Object.hasOwn(p2, "players"), false);
  assert.equal(Object.hasOwn(p1.own, "deck"), false);
});

test("server engine rejects wrong turn, nonexistent cards, and occupied cells", () => {
  const engine = game();
  engine.players[0].hand = ["sword"];
  engine.players[1].hand = ["shield"];
  assert.match(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).error, /不是你的回合/);
  assert.match(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "spear", rank: 1 })).error, /沒有足夠/);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 1 })).ok, true);
  assert.equal(endTurn(engine, 1).ok, true);
  assert.match(engine.deploy(2, intent(engine, { r: 0, c: 0, type: "shield", rank: 1 })).error, /已有單位/);
});

test("artillery is limited, does not consume deployment, and cannot be chained", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.artillery(1, intent(engine, { r: 4, c: 4 })).ok, true);
  assert.equal(engine.current, 1);
  assert.equal(engine.actionsThisRound, 0);
  assert.equal(engine.players[0].artillery, 1);
  assert.match(engine.artillery(1, intent(engine, { r: 4, c: 4 })).error, /最多使用一次/);
  assert.match(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).error, /不是你的回合/);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 1 })).ok, true);
  assert.equal(endTurn(engine, 1).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  assert.match(engine.deploy(2, intent(engine, { r: 8, c: 6, type: "shield", rank: 1 })).error,
    /本回合已完成部署/);
  assert.equal(endTurn(engine, 2).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 6, type: "shield", rank: 1 })).ok, true);
  assert.equal(engine.artillery(2, intent(engine, { r: 7, c: 7 })).ok, true,
    "部署後仍然可以炮擊");
  assert.equal(endTurn(engine, 2).ok, true);
  assert.equal(engine.artillery(1, intent(engine, { r: 7, c: 7 })).ok, true);
  assert.equal(engine.players[0].artillery, 0);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 1 })).ok, true);
  assert.match(engine.artillery(1, intent(engine, { r: 4, c: 4 })).error, /最多使用一次|已用完/);
});

test("階段四：部署後不換人，仍可炮擊，最後由玩家明確結束回合", () => {
  let now = 1_000;
  const engine = new GameEngine({
    matchId: "manual-end-turn",
    roomCode: "PHASE4",
    randomInt: () => 0,
    turnOrderMode: "fixed",
    startingPlayer: 1,
    now: () => now,
  });
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  const originalTurnId = engine.turnId;

  assert.match(engine.endTurn(1, { turnId: originalTurnId }).error, /請先完成部署或移動/);
  assert.equal(engine.deploy(1, {
    r: 0, c: 0, type: "sword", rank: 1, turnId: originalTurnId,
  }).ok, true);
  assert.equal(engine.current, 1, "部署只提交主要行動，不得自動交棒");
  assert.equal(engine.turnId, originalTurnId, "部署後同一張回合票仍可用於炮擊與結束回合");
  assert.equal(engine.deploymentCommitted, true);
  assert.equal(engine.artillery(1, { r: 4, c: 4, turnId: originalTurnId }).ok, true,
    "部署完成後仍可使用本回合炮擊");

  now = 6_000;
  assert.equal(engine.endTurn(1, { turnId: originalTurnId }).ok, true);
  assert.equal(engine.current, 2);
  assert.equal(engine.turnId, originalTurnId + 1);
  assert.equal(engine.deploymentCommitted, false);
  assert.equal(engine.artilleryUsedThisTurn, false);
  assert.equal(engine.turnDeadline, now + GameEngine.timeoutRules().turnMs,
    "新回合倒數必須從交棒時重新給完整時間");
});

test("階段四：20 秒到期會自動結束回合，即使玩家完全沒有行動", () => {
  let now = 10_000;
  const engine = new GameEngine({
    matchId: "turn-timeout",
    roomCode: "TIME20",
    randomInt: () => 0,
    turnOrderMode: "fixed",
    startingPlayer: 1,
    now: () => now,
  });
  assert.deepEqual(GameEngine.timeoutRules(), { turnMs: 20_000, disconnectMs: 40_000 });
  const rulesCopy = GameEngine.timeoutRules();
  rulesCopy.turnMs = 1;
  assert.equal(GameEngine.timeoutRules().turnMs, 20_000, "外部不得改寫引擎唯一的逾時規則");

  now += 19_999;
  assert.equal(engine.checkTurnTimeout(), null, "截止前 1ms 不得提早交棒");
  now += 1;
  const result = engine.checkTurnTimeout();
  assert.equal(result.ok, true);
  assert.equal(result.automatic, true);
  assert.equal(engine.current, 2);
  assert.equal(engine.actionsThisRound, 1, "逾時視為本輪該玩家的回合已完成");
  assert.ok(engine.logs.some(entry => /回合逾時.*自動結束回合/.test(entry.text)));
  assert.deepEqual(engine.visibleStateFor(1).timeoutRules, GameEngine.timeoutRules());
});

test("階段四：斷線會凍結剩餘回合時間，重連後續算而非重置", () => {
  let now = 50_000;
  const engine = new GameEngine({
    matchId: "paused-turn",
    roomCode: "PAUSE4",
    randomInt: () => 0,
    turnOrderMode: "fixed",
    startingPlayer: 1,
    now: () => now,
  });

  now += 5_000;
  engine.pauseTurnClock();
  assert.deepEqual(engine.turnClockState(), {
    deadline: null,
    paused: true,
    remainingMs: 15_000,
  });
  now += 100_000;
  assert.equal(engine.checkTurnTimeout(), null, "斷線暫停期間不得吃掉回合時間");

  engine.resumeTurnClock();
  assert.equal(engine.turnDeadline, now + 15_000, "重連只續算原本剩餘時間");
  now += 14_999;
  assert.equal(engine.checkTurnTimeout(), null);
  now += 1;
  assert.equal(engine.checkTurnTimeout().automatic, true);
  assert.equal(engine.current, 2);
});

test("階段四：炮擊若消滅最後可移動棋子，玩家仍可立即結束回合", () => {
  const engine = new GameEngine({
    matchId: "artillery-no-action",
    roomCode: "NOACT4",
    randomInt: () => 0,
    turnOrderMode: "fixed",
    startingPlayer: 1,
  });
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  const stats = baseStats("shield", 1);
  engine.board[4][4] = {
    id: 99, pid: 1, type: "shield", rank: 1, cards: 1,
    hp: 1, maxHp: stats.maxHp, atk: stats.atk,
  };
  engine.players[0].hand = [];
  engine.players[0].deck = [];
  assert.equal(engine.canAct(1), true, "炮擊前仍可移動唯一棋子");
  assert.equal(engine.artillery(1, { r: 4, c: 4, turnId: engine.turnId }).ok, true);
  assert.equal(engine.canAct(1), false, "炮擊誤殺後已無主要行動可做");
  assert.equal(engine.visibleStateFor(1).canAct, false,
    "連線 UI 必須直接讀引擎判斷，不自行重算合法行動");
  assert.equal(engine.deploymentCommitted, false);
  assert.equal(engine.endTurn(1, { turnId: engine.turnId }).ok, true,
    "不得強迫玩家空等到 20 秒逾時");
  assert.equal(engine.current, 2);
});

test("each server-issued turn permits only one deployment, including artillery and round boundaries", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");

  const p1Turn = engine.turnId;
  assert.equal(engine.deploy(1, { r: 0, c: 0, type: "sword", rank: 1, turnId: p1Turn }).ok, true);
  assert.match(engine.deploy(1, { r: 0, c: 1, type: "sword", rank: 1, turnId: p1Turn }).error,
    /本回合已完成部署/);
  assert.equal(engine.endTurn(1, { turnId: p1Turn }).ok, true);
  assert.match(engine.deploy(1, { r: 0, c: 1, type: "sword", rank: 1, turnId: p1Turn }).error, /操作已過期/);

  const p2Turn = engine.turnId;
  assert.equal(engine.deploy(2, { r: 8, c: 8, type: "shield", rank: 1, turnId: p2Turn }).ok, true);
  assert.equal(engine.endTurn(2, { turnId: p2Turn }).ok, true);
  assert.equal(engine.current, 2, "P2 is also first next round under the frozen initiative rule");
  assert.match(engine.deploy(2, { r: 8, c: 7, type: "shield", rank: 1, turnId: p2Turn }).error, /操作已過期/);

  const nextP2Turn = engine.turnId;
  assert.equal(engine.artillery(2, { r: 4, c: 4, turnId: nextP2Turn }).ok, true);
  assert.equal(engine.deploy(2, { r: 8, c: 7, type: "shield", rank: 1, turnId: nextP2Turn }).ok, true);
  assert.match(engine.deploy(2, { r: 8, c: 6, type: "shield", rank: 1, turnId: nextP2Turn }).error,
    /本回合已完成部署/);
  assert.equal(engine.board.flat().filter(Boolean).length, 3);
});

test("fixed-order mode keeps the randomly selected starter first in every round", () => {
  const engine = new GameEngine({
    matchId: "fixed-order",
    roomCode: "FIXED1",
    turnOrderMode: "fixed",
    randomInt: () => 1,
  });
  assert.equal(engine.startingPlayer, 2);
  assert.equal(engine.current, 2);
  assert.equal(engine.firstPlayerForRound(1), 2);
  assert.equal(engine.firstPlayerForRound(2), 2);
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  assert.equal(endTurn(engine, 2).ok, true);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 1 })).ok, true);
  assert.equal(endTurn(engine, 1).ok, true);
  assert.equal(engine.roundNo, 2);
  assert.equal(engine.current, 2);
  assert.equal(engine.visibleStateFor(1).firstPlayer, 2);
  assert.deepEqual(engine.roundRecords.map(record => record.firstPlayer), [2, 2]);
  assert.equal(engine.fullMatchReport().firstRoundFirstPlayer, 2);
  assert.equal(engine.fullMatchReport().rules.turnOrderMode, "fixed");
});

test("combat resolves once after both deployments", () => {
  const engine = game();
  engine.players[0].hand = ["sword"];
  engine.players[1].hand = ["shield"];
  engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 1 }));
  endTurn(engine, 1);
  engine.deploy(2, intent(engine, { r: 4, c: 5, type: "shield", rank: 1 }));
  endTurn(engine, 2);
  assert.ok(engine.roundRecords[0].combat);
  assert.equal(engine.logs.filter(item => item.text.includes("由伺服器結算一次")).length, 1);
  assert.equal(engine.board[4][4].hp, 95);
  // 盾不再減傷：劍 24 ATK 單目標決鬥 ×1.5 = 36 全額進入，160 - 36 = 124。
  assert.equal(engine.board[4][5].hp, 124);
});

test("elite deployments conserve all 25 cards under the one-per-type cap", () => {
  const engine = game();
  for (const player of engine.players) {
    player.hand = ["sword", "sword", "sword", "shield", "shield"];
    player.deck = [...Array(6).fill("sword"), ...Array(7).fill("shield"), ...Array(7).fill("spear")];
    player.cooldown = [];
  }
  engine.cardConservationAudits = [];
  const spots = { 1: [[0, 0], [0, 2], [0, 4]], 2: [[8, 0], [8, 2], [8, 4]] };
  const placed = { 1: 0, 2: 0 };
  while (placed[2] < 3) {
    const pid = engine.current;
    const [r, c] = spots[pid][placed[pid]];
    const rank = placed[pid] === 0 ? 2 : 1;              // 第一手★★劍，之後只能出★劍
    const result = engine.deploy(pid, intent(engine, { r, c, type: "sword", rank }));
    assert.equal(result.ok, true, result.error);
    assert.equal(endTurn(engine, pid).ok, true);
    placed[pid]++;
    assert.equal(engine.cardDistribution(1).total, 25);
    assert.equal(engine.cardDistribution(2).total, 25);
  }
  assert.equal(engine.cardConservationAudits.every(audit => audit.valid), true);
});

test("rank three is disabled", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  const result = engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 3 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /★★★/);
  assert.equal(baseStats("sword", 3), null);
});

test("death dismantles an elite's three bound cards into cooldown", () => {
  const engine = game();
  const stats = baseStats("sword", 2);
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  engine.players[0].hand = [];
  engine.players[0].deck = Array(22).fill("sword");
  engine.players[0].cooldown = [];
  engine.board[4][4] = { id: 999, pid: 1, type: "sword", rank: 2, cards: 3, hp: 0, maxHp: stats.maxHp, atk: stats.atk };
  const deaths = [];
  engine.removeDead("combat", deaths);
  assert.equal(deaths.length, 1);
  assert.deepEqual(engine.cardDistribution(1), { deck: 22, hand: 0, cooldown: 3, boardBoundCards: 0, total: 25, valid: true });
  engine.ownerTurnStart(1);
  engine.ownerTurnStart(1);
  engine.ownerTurnStart(1);
  assert.equal(engine.players[0].cooldown.length, 0);
  assert.equal(engine.cardDistribution(1).total, 25);
});

test("手牌用盡時改為移動一格，不判輸", () => {
  const engine = new GameEngine({ roomCode: "MOVE", turnOrderMode: "fixed", startingPlayer: 1,
    randomInt: () => 0 });
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  let nextId = 1;
  const put = (r, c, pid) => {
    const stats = baseStats("shield", 1);
    engine.board[r][c] = { id: nextId++, pid, type: "shield", rank: 1, cards: 1,
      hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk };
    return engine.board[r][c];
  };
  const unit = put(4, 4, 1);
  put(0, 0, 2);
  engine.players[0].hand = ["shield"];

  // 還有手牌時不能改用移動——移動是替代行動，不是額外行動
  assert.equal(engine.canDeploy(1), true);
  assert.deepEqual(engine.legalMoves(1), []);
  assert.match(engine.move(1, { r: 4, c: 4, toR: 4, toC: 5, turnId: engine.turnId }).error, /不能改用移動/);

  // 手牌用盡後才解鎖
  engine.players[0].hand = [];
  engine.players[0].deck = [];
  assert.equal(engine.canDeploy(1), false);
  assert.equal(engine.legalMoves(1).length, 4, "中央的棋子有四個正交方向");
  assert.equal(engine.canAct(1), true, "有得移動就還有行動，不該判輸");

  // 手動擺盤的卡片總數本來就不是 25，所以比對「移動前後有沒有變動」才有意義
  const before = engine.cardDistribution(1);
  const moved = engine.move(1, { r: 4, c: 4, toR: 4, toC: 5, turnId: engine.turnId });
  assert.equal(moved.ok, true);
  assert.equal(engine.board[4][5], unit);
  assert.equal(engine.board[4][4], null);
  assert.equal(engine.gameOver, false, "沒牌不判輸");
  const after = engine.cardDistribution(1);
  assert.deepEqual(after, before, "移動只換位置，不動任何一張牌");
});

test("移動只能往正交相鄰的空格走一格，而且只能動自己的棋", () => {
  const fresh = () => {
    const engine = new GameEngine({ roomCode: "MOVE2", turnOrderMode: "fixed", startingPlayer: 1,
      randomInt: () => 0 });
    engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
    let nextId = 1;
    const put = (r, c, pid) => {
      const stats = baseStats("shield", 1);
      engine.board[r][c] = { id: nextId++, pid, type: "shield", rank: 1, cards: 1,
        hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk };
    };
    put(4, 4, 1); put(0, 0, 2); put(4, 3, 1);
    engine.players[0].hand = []; engine.players[0].deck = [];
    return engine;
  };
  const cases = [
    [{ r: 4, c: 4, toR: 5, toC: 5 }, /一格/, "斜走"],
    [{ r: 4, c: 4, toR: 4, toC: 6 }, /一格/, "走兩格"],
    [{ r: 0, c: 0, toR: 0, toC: 1 }, /自己的單位/, "移動敵方"],
    [{ r: 4, c: 4, toR: 4, toC: 3 }, /已有單位/, "目標格有人"],
    [{ r: 1, c: 1, toR: 1, toC: 2 }, /起點沒有單位/, "起點是空的"],
  ];
  for (const [intent, pattern, label] of cases) {
    const engine = fresh();
    const result = engine.move(1, { ...intent, turnId: engine.turnId });
    assert.equal(result.ok, false, `${label} 不該成功`);
    assert.match(result.error, pattern, label);
  }
});

test("沒牌又沒有合法移動時自動跳過該回合，而不是判輸", () => {
  const engine = new GameEngine({ roomCode: "SKIP", turnOrderMode: "fixed", startingPlayer: 1,
    randomInt: () => 0 });
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  // P2 完全沒有棋子、沒有手牌、冷卻還要等 3 輪才回得來
  engine.players[0].hand = ["shield"];
  engine.players[0].deck = ["shield", "shield"];
  engine.players[1].hand = [];
  engine.players[1].deck = [];
  engine.players[1].cooldown = [{ type: "shield", turns: 3 }];
  assert.equal(engine.canAct(2), false);

  assert.equal(engine.deploy(1, { r: 4, c: 4, type: "shield", rank: 1, turnId: engine.turnId }).ok, true);
  assert.equal(endTurn(engine, 1).ok, true);
  assert.equal(engine.gameOver, false, "無法行動的一方不判輸");
  assert.equal(engine.winner, null);
  assert.ok(engine.logs.some(entry => /跳過本回合/.test(entry.text)), "要留下跳過紀錄");
  assert.equal(engine.roundNo, 2, "P2 被跳過後回合正常推進");
});

test("移動規則的參數只有一份，且標明是沒牌時的替代行動", () => {
  const rules = GameEngine.movementRules();
  assert.deepEqual(rules, { range: 1, orthogonalOnly: true, onlyWhenCannotDeploy: true,
    skipWhenNoLegalMove: true });
  const state = new GameEngine({ roomCode: "MR", turnOrderMode: "fixed", startingPlayer: 1,
    randomInt: () => 0 }).visibleStateFor(1);
  assert.deepEqual(state.movementRules, rules);
  // 舊的斷糧判輸規則必須整組移除
  assert.equal(typeof GameEngine.terminalRules, "undefined");
  assert.equal(typeof GameEngine.prototype.concludeNoDeployment, "undefined");
});
