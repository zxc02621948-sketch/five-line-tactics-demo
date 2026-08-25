const test = require("node:test");
const assert = require("node:assert/strict");
const { GameEngine, baseStats } = require("../game_engine");

function game() {
  return new GameEngine({ matchId: "test-match", roomCode: "ABC123", randomInt: () => 0 });
}

function intent(engine, fields) {
  return { ...fields, turnId: engine.turnId };
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
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 6, type: "shield", rank: 1 })).ok, true);
  assert.equal(engine.artillery(1, intent(engine, { r: 7, c: 7 })).ok, true);
  assert.equal(engine.players[0].artillery, 0);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 1 })).ok, true);
  assert.match(engine.artillery(1, intent(engine, { r: 4, c: 4 })).error, /已用完/);
});

test("each server-issued turn permits only one deployment, including artillery and round boundaries", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");

  const p1Turn = engine.turnId;
  assert.equal(engine.deploy(1, { r: 0, c: 0, type: "sword", rank: 1, turnId: p1Turn }).ok, true);
  assert.match(engine.deploy(1, { r: 0, c: 1, type: "sword", rank: 1, turnId: p1Turn }).error, /操作已過期/);

  const p2Turn = engine.turnId;
  assert.equal(engine.deploy(2, { r: 8, c: 8, type: "shield", rank: 1, turnId: p2Turn }).ok, true);
  assert.equal(engine.current, 2, "P2 is also first next round under the frozen initiative rule");
  assert.match(engine.deploy(2, { r: 8, c: 7, type: "shield", rank: 1, turnId: p2Turn }).error, /操作已過期/);

  const nextP2Turn = engine.turnId;
  assert.equal(engine.artillery(2, { r: 4, c: 4, turnId: nextP2Turn }).ok, true);
  assert.equal(engine.deploy(2, { r: 8, c: 7, type: "shield", rank: 1, turnId: nextP2Turn }).ok, true);
  assert.match(engine.deploy(2, { r: 8, c: 6, type: "shield", rank: 1, turnId: nextP2Turn }).error, /操作已過期/);
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
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 1 })).ok, true);
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
  engine.deploy(2, intent(engine, { r: 4, c: 5, type: "shield", rank: 1 }));
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

test("the responding player loses when turn-start draw still leaves no deployable card", () => {
  const engine = game();
  engine.players[0].hand = ["sword"];
  engine.players[0].deck = [];
  engine.players[0].cooldown = [];
  engine.players[1].hand = [];
  engine.players[1].deck = [];
  engine.players[1].cooldown = [];

  const result = engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 1 }));
  assert.equal(result.ok, true);
  assert.equal(engine.gameOver, true);
  assert.equal(engine.winner, 1);
  assert.equal(engine.endReason, "opponent_supply_exhausted");
  assert.equal(engine.visibleStateFor(1).endReason, "opponent_supply_exhausted");
});

test("between rounds, one exhausted supply loses and simultaneous exhaustion draws", () => {
  const oneEmpty = game();
  oneEmpty.players[0].hand = ["sword"];
  oneEmpty.players[0].deck = [];
  oneEmpty.players[0].cooldown = [];
  oneEmpty.players[1].hand = ["shield", "shield"];
  oneEmpty.players[1].deck = [];
  oneEmpty.players[1].cooldown = [];
  oneEmpty.deploy(1, intent(oneEmpty, { r: 0, c: 0, type: "sword", rank: 1 }));
  oneEmpty.deploy(2, intent(oneEmpty, { r: 8, c: 8, type: "shield", rank: 1 }));
  assert.equal(oneEmpty.winner, 2);
  assert.equal(oneEmpty.endReason, "opponent_supply_exhausted");

  const bothEmpty = game();
  bothEmpty.players[0].hand = ["sword"];
  bothEmpty.players[0].deck = [];
  bothEmpty.players[0].cooldown = [];
  bothEmpty.players[1].hand = ["shield"];
  bothEmpty.players[1].deck = [];
  bothEmpty.players[1].cooldown = [];
  bothEmpty.deploy(1, intent(bothEmpty, { r: 0, c: 0, type: "sword", rank: 1 }));
  bothEmpty.deploy(2, intent(bothEmpty, { r: 8, c: 8, type: "shield", rank: 1 }));
  assert.equal(bothEmpty.winner, "draw");
  assert.equal(bothEmpty.endReason, "supply_exhausted_both");
  assert.equal(bothEmpty.fullMatchReport().endReason, "supply_exhausted_both");
});

test("a full board ends as a draw instead of leaving a non-terminal turn", () => {
  const engine = game();
  const stats = baseStats("shield", 1);
  let id = 1;
  engine.board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ({
    id: id++, pid: (r + c) % 2 + 1, type: "shield", rank: 1, cards: 1,
    hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk,
  })));
  const result = engine.concludeNoDeployment({ betweenRounds: true, roundResolved: true });
  assert.equal(result.gameOver, true);
  assert.equal(engine.winner, "draw");
  assert.equal(engine.endReason, "board_full");
  assert.deepEqual(GameEngine.terminalRules(), {
    boardFull: "draw",
    bothSupplyExhausted: "draw",
    oneSupplyExhausted: "opponent_wins",
  });
});
