const test = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, baseStats } = require('../game_engine');
require('../local_ai');
const { choose } = globalThis.FiveLineAI;
function fixture() {
  const game = new GameEngine({ randomInt: () => 0, turnOrderMode: 'fixed', startingPlayer: 1 });
  game.current = 2; game.actionsThisRound = 1;
  return game;
}
function snapshot(game) {
  return {
    pid: 2, now: Date.now(), matchId: game.matchId, turnId: game.turnId,
    board: structuredClone(game.board), hand: [...game.players[1].hand],
    artillery: { 1: game.players[0].artillery, 2: game.players[1].artillery },
    roundNo: game.roundNo, actionsThisRound: game.actionsThisRound,
    deploymentCommitted: game.deploymentCommitted, artilleryUsedThisTurn: game.artilleryUsedThisTurn,
    nextUnitId: game.nextUnitId, overtime: game.overtime,
    overtimeStartRound: game.overtimeStartRound, quietRounds: game.quietRounds,
  };
}
function apply(game, plan) {
  assert.ok(plan, 'AI must produce a plan');
  for (const action of plan.actions) {
    assert.ok(['deploy', 'move', 'artillery'].includes(action.kind));
    assert.equal(game[action.kind](2, { ...action, turnId: game.turnId }).ok, true,
      `AI action must be legal: ${JSON.stringify(action)}`);
  }
  assert.equal(game.endTurn(2, { turnId: game.turnId }).ok, true);
}
function put(game, r, c, pid, type = 'sword') {
  const stats = baseStats(type, 1);
  game.board[r][c] = { id: game.nextUnitId++, pid, type, rank: 1, cards: 1,
    hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk };
}
test('AI uses a hidden-information-free snapshot without mutating its input', async () => {
  const game = fixture(), input = snapshot(game), before = structuredClone(input);
  assert.equal(Object.hasOwn(input, 'players'), false);
  apply(game, await choose(input, { budgetMs: 400 }));
  assert.deepEqual(input, before);
});
test('AI completes a five-line that survives official combat', async () => {
  const game = fixture();
  for (let c = 0; c < 4; c++) put(game, 0, c, 2);
  put(game, 8, 8, 1);
  game.players[1].hand = ['sword']; game.players[1].artillery = 0;
  apply(game, await choose(snapshot(game), { budgetMs: 800 }));
  assert.equal(game.gameOver, true);
  assert.equal(game.winner, 2);
  assert.equal(game.endReason, 'five_line');
});
test('AI with no cards selects a legal move and ends its turn', async () => {
  const game = fixture(); put(game, 4, 4, 2); put(game, 8, 8, 1);
  game.players[1].hand = []; game.players[1].artillery = 0;
  const plan = await choose(snapshot(game), { budgetMs: 300 });
  assert.ok(plan.actions.some(action => action.kind === 'move'));
  apply(game, plan);
});
test('AI cancellation and exhausted budget return no plan', async () => {
  const input = snapshot(fixture());
  assert.equal(await choose(input, { budgetMs: 0 }), null);
  assert.equal(await choose(input, { isCancelled: () => true }), null);
  let checks = 0;
  assert.equal(await choose(input, { budgetMs: 1000, isCancelled: () => ++checks > 8 }), null);
});
