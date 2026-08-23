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

test("combat resolves once after both deployments", () => {
  const engine = game();
  engine.players[0].hand = ["sword"];
  engine.players[1].hand = ["shield"];
  engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 1 }));
  engine.deploy(2, intent(engine, { r: 4, c: 5, type: "shield", rank: 1 }));
  assert.ok(engine.roundRecords[0].combat);
  assert.equal(engine.logs.filter(item => item.text.includes("由伺服器結算一次")).length, 1);
  assert.equal(engine.board[4][4].hp, 95);
  assert.equal(engine.board[4][5].hp, 133);
});

test("frequent rank-two deployments conserve all 25 cards", () => {
  const engine = game();
  for (const player of engine.players) {
    player.hand = Array(5).fill("sword");
    player.deck = Array(20).fill("sword");
    player.cooldown = [];
  }
  engine.cardConservationAudits = [];
  engine.auditCardConservation("rank2_repro_start");

  const positions = {
    1: [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [2, 0], [2, 2], [2, 4], [2, 6]],
    2: [[8, 0], [8, 2], [8, 4], [8, 6], [8, 8], [6, 0], [6, 2], [6, 4], [6, 6]],
  };
  const placed = { 1: 0, 2: 0 };
  while (placed[2] < 9) {
    const pid = engine.current;
    const [r, c] = positions[pid][placed[pid]];
    const rank = pid === 2 && placed[2] < 8 ? 2 : 1;
    const result = engine.deploy(pid, intent(engine, { r, c, type: "sword", rank }));
    assert.equal(result.ok, true, result.error);
    placed[pid]++;
    assert.equal(engine.cardDistribution(1).total, 25);
    assert.equal(engine.cardDistribution(2).total, 25);
  }

  assert.deepEqual(engine.cardDistribution(2), {
    deck: 0,
    hand: 0,
    cooldown: 0,
    boardBoundCards: 25,
    total: 25,
    valid: true,
  });
  assert.equal(engine.board.flat().filter(unit => unit?.pid === 2).length, 9);
  assert.equal(engine.cardConservationAudits.every(audit => audit.valid), true);
});

test("five rank-three units bind all 25 cards while keeping five units on board", () => {
  const engine = game();
  for (const player of engine.players) {
    player.hand = Array(5).fill("sword");
    player.deck = Array(20).fill("sword");
    player.cooldown = [];
  }
  engine.cardConservationAudits = [];
  const positions = {
    1: [[0, 0], [0, 2], [0, 4], [2, 0], [2, 2]],
    2: [[8, 0], [8, 2], [8, 4], [6, 0], [6, 2]],
  };
  const placed = { 1: 0, 2: 0 };
  while (placed[1] < 5) {
    const pid = engine.current;
    const [r, c] = positions[pid][placed[pid]];
    const rank = pid === 1 ? 3 : 1;
    const result = engine.deploy(pid, intent(engine, { r, c, type: "sword", rank }));
    assert.equal(result.ok, true, result.error);
    placed[pid]++;
  }
  const distribution = engine.cardDistribution(1);
  assert.equal(engine.board.flat().filter(unit => unit?.pid === 1).length, 5);
  assert.deepEqual(distribution, { deck: 0, hand: 0, cooldown: 0, boardBoundCards: 25, total: 25, valid: true });
  assert.equal(engine.cardConservationAudits.every(audit => audit.valid), true);
});

test("death dismantles bound cards into cooldown without breaking 25-card conservation", () => {
  const engine = game();
  const stats = baseStats("sword", 3);
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  engine.players[0].hand = [];
  engine.players[0].deck = Array(20).fill("sword");
  engine.players[0].cooldown = [];
  engine.board[4][4] = { id: 999, pid: 1, type: "sword", rank: 3, cards: 5, hp: 0, maxHp: stats.maxHp, atk: stats.atk };
  const deaths = [];
  engine.removeDead("combat", deaths);
  assert.equal(deaths.length, 1);
  assert.deepEqual(engine.cardDistribution(1), { deck: 20, hand: 0, cooldown: 5, boardBoundCards: 0, total: 25, valid: true });
  engine.ownerTurnStart(1);
  engine.ownerTurnStart(1);
  engine.ownerTurnStart(1);
  assert.equal(engine.cardDistribution(1).total, 25);
  assert.equal(engine.players[0].cooldown.length, 0);
});
