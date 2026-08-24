const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");
const { baseStats } = require("../game_engine");

const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "five-line-alpha-"));
process.env.MATCH_LOG_DIR = tempLogDir;
const { server, wss, rooms } = require("../server");

function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on("message", raw => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex(item => item.predicate(message));
    if (index >= 0) {
      const [{ resolve, timer }] = waiters.splice(index, 1);
      clearTimeout(timer);
      resolve(message);
    } else inbox.push(message);
  });
  return {
    ws,
    open: () => new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }),
    send: message => ws.send(JSON.stringify(message)),
    wait(predicate, timeout = 3000) {
      const existing = inbox.findIndex(predicate);
      if (existing >= 0) return Promise.resolve(inbox.splice(existing, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for WebSocket message"));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
}

test("two sessions synchronize, preserve privacy, reject illegal actions, win, and save report", async t => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempLogDir, { recursive: true, force: true });
  });
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const p1 = client(url);
  let p2 = client(url);
  await Promise.all([p1.open(), p2.open()]);

  p1.send({ type: "create_room" });
  const p1Session = await p1.wait(message => message.type === "session");
  const code = p1Session.roomCode;
  p2.send({ type: "join_room", roomCode: code });
  const p2Session = await p2.wait(message => message.type === "session");
  const [p1StateMessage, p2StateMessage] = await Promise.all([
    p1.wait(message => message.type === "state" && message.state),
    p2.wait(message => message.type === "state" && message.state),
  ]);
  const p1State = p1StateMessage.state, p2State = p2StateMessage.state;
  assert.equal(p1State.selfPid, 1);
  assert.equal(p2State.selfPid, 2);
  assert.equal(Object.hasOwn(p1State.opponent, "hand"), false);
  assert.equal(Object.hasOwn(p2State.opponent, "hand"), false);
  assert.equal(Object.hasOwn(p1State.own, "deck"), false);
  assert.equal(p1State.opponent.handCount, p2State.own.hand.length);
  assert.equal(p1State.cardDistribution.P1.total, 25);
  assert.equal(p1State.cardDistribution.P2.total, 25);
  // 正式建房一律是 Alpha Core 的固定 P1 → P2
  assert.equal(p1State.turnOrderMode, "fixed");
  assert.equal(p1State.startingPlayer, 1);
  assert.equal(p1State.firstPlayer, 1);

  const fixedP1 = client(url), fixedP2 = client(url);
  await Promise.all([fixedP1.open(), fixedP2.open()]);
  fixedP1.send({ type: "create_room", mode: "fixed" });
  const fixedSession = await fixedP1.wait(message => message.type === "session");
  fixedP2.send({ type: "join_room", roomCode: fixedSession.roomCode });
  await fixedP2.wait(message => message.type === "session");
  const [fixedState1, fixedState2] = await Promise.all([
    fixedP1.wait(message => message.type === "state" && message.state),
    fixedP2.wait(message => message.type === "state" && message.state),
  ]);
  const fixedStates = { 1: fixedState1.state, 2: fixedState2.state };
  const fixedClients = { 1: fixedP1, 2: fixedP2 };
  const fixedFirst = fixedState1.state.startingPlayer;
  const fixedSecond = 3 - fixedFirst;
  assert.equal(fixedState1.state.turnOrderMode, "fixed");
  assert.equal(fixedState1.state.firstPlayer, fixedFirst);
  fixedClients[fixedFirst].send({ type: "action", requestId: "fixed-first", intent: { kind: "deploy", r: 0, c: 0, type: fixedStates[fixedFirst].own.hand[0], rank: 1, turnId: fixedStates[fixedFirst].turnId } });
  await fixedClients[fixedFirst].wait(message => message.type === "accepted" && message.requestId === "fixed-first");
  const fixedSecondTurn = await fixedClients[fixedSecond].wait(message => message.type === "state" && message.state?.current === fixedSecond);
  fixedClients[fixedSecond].send({ type: "action", requestId: "fixed-second", intent: { kind: "deploy", r: 8, c: 8, type: fixedSecondTurn.state.own.hand[0], rank: 1, turnId: fixedSecondTurn.state.turnId } });
  await fixedClients[fixedSecond].wait(message => message.type === "accepted" && message.requestId === "fixed-second");
  const fixedRound2 = await fixedClients[fixedFirst].wait(message => message.type === "state" && message.state?.roundNo === 2);
  assert.equal(fixedRound2.state.current, fixedFirst);
  assert.equal(fixedRound2.state.firstPlayer, fixedFirst);
  fixedP1.ws.close(); fixedP2.ws.close();

  p2.ws.close();
  const disconnected = await p1.wait(message => message.type === "state" && message.status === "opponent_disconnected");
  assert.equal(disconnected.opponentConnected, false);
  p2 = client(url);
  await p2.open();
  p2.send({ type: "reconnect", roomCode: code, token: p2Session.token });
  await p2.wait(message => message.type === "session" && message.pid === 2);
  await Promise.all([
    p1.wait(message => message.type === "state" && message.status === "playing"),
    p2.wait(message => message.type === "state" && message.status === "playing"),
  ]);

  p2.send({ type: "action", requestId: "wrong-turn", intent: { kind: "deploy", r: 8, c: 8, type: p2State.own.hand[0], rank: 1, turnId: p2State.turnId } });
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "wrong-turn")).error, /不是你的回合/);

  const count = { sword: 0, shield: 0, spear: 0 };
  p1State.own.hand.forEach(type => count[type]++);
  // 5 張手牌分 3 種兵種，必定至少有一種不足 3 張（★★ 的成本）
  const impossible = Object.keys(count).find(type => count[type] < 3);
  p1.send({ type: "action", requestId: "missing-card", intent: { kind: "deploy", r: 0, c: 0, type: impossible, rank: 2, turnId: p1State.turnId } });
  assert.match((await p1.wait(message => message.type === "rejected" && message.requestId === "missing-card")).error, /沒有足夠/);

  const p1Deploy = { type: "action", requestId: "p1-deploy", intent: { kind: "deploy", r: 4, c: 4, type: p1State.own.hand[0], rank: 1, turnId: p1State.turnId } };
  p1.send(p1Deploy);
  p1.send(p1Deploy);
  p1.send({ type: "action", requestId: "p1-rapid-second", intent: { kind: "deploy", r: 4, c: 3, type: p1State.own.hand[0], rank: 1, turnId: p1State.turnId } });
  await p1.wait(message => message.type === "accepted" && message.requestId === "p1-deploy");
  assert.match((await p1.wait(message => message.type === "rejected" && message.requestId === "p1-rapid-second")).error, /操作已過期/);
  const p2Turn = await p2.wait(message => message.type === "state" && message.state?.current === 2);
  p2.send({ type: "action", requestId: "occupied", intent: { kind: "deploy", r: 4, c: 4, type: p2Turn.state.own.hand[0], rank: 1, turnId: p2Turn.state.turnId } });
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "occupied")).error, /已有單位/);
  p2.send({ type: "action", requestId: "artillery-1", intent: { kind: "artillery", r: 4, c: 4, turnId: p2Turn.state.turnId } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "artillery-1");
  p2.send({ type: "action", requestId: "artillery-2", intent: { kind: "artillery", r: 4, c: 4, turnId: p2Turn.state.turnId } });
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "artillery-2")).error, /最多使用一次/);
  p2.send({ type: "action", requestId: "p2-deploy", intent: { kind: "deploy", r: 8, c: 8, type: p2Turn.state.own.hand[0], rank: 1, turnId: p2Turn.state.turnId } });
  p2.send({ type: "action", requestId: "p2-rapid-second", intent: { kind: "deploy", r: 8, c: 7, type: p2Turn.state.own.hand[0], rank: 1, turnId: p2Turn.state.turnId } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "p2-deploy");
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "p2-rapid-second")).error, /操作已過期/);
  const [sync1, sync2] = await Promise.all([
    p1.wait(message => message.type === "state" && message.state?.roundNo === 2),
    p2.wait(message => message.type === "state" && message.state?.roundNo === 2),
  ]);
  assert.deepEqual(sync1.state.board, sync2.state.board);
  const room = rooms.get(code);
  assert.equal(room.game.roundRecords[0].combat !== null, true);
  assert.equal(room.game.combatResolutionCount, 1);

  const engine = room.game;
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  engine.roundNo = 3;
  engine.actionsThisRound = 0;
  engine.current = 1;
  engine.turnId++;
  engine.artilleryUsedThisTurn = false;
  engine.deploymentCommitted = false;
  engine.gameOver = false;
  engine.winner = null;
  engine.ensureRoundRecord();
  engine.players[0].hand = ["sword"];
  engine.players[1].hand = ["shield"];
  engine.players[0].deck = Array(20).fill("sword");
  engine.players[1].deck = Array(24).fill("shield");
  engine.players[0].cooldown = [];
  engine.players[1].cooldown = [];
  engine.cardConservationAudits = [];
  const sword = baseStats("sword", 1);
  for (let c = 0; c < 4; c++) engine.board[0][c] = { id: engine.nextUnitId++, pid: 1, type: "sword", rank: 1, cards: 1, hp: sword.maxHp, maxHp: sword.maxHp, atk: sword.atk };
  engine.auditCardConservation("forced_win_fixture");

  p1.send({ type: "action", requestId: "winning-deploy", intent: { kind: "deploy", r: 0, c: 4, type: "sword", rank: 1, turnId: engine.turnId } });
  await p1.wait(message => message.type === "accepted" && message.requestId === "winning-deploy");
  p2.send({ type: "action", requestId: "final-reply", intent: { kind: "deploy", r: 8, c: 8, type: "shield", rank: 1, turnId: engine.turnId } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "final-reply");
  const [end1, end2] = await Promise.all([
    p1.wait(message => message.type === "state" && message.state?.gameOver),
    p2.wait(message => message.type === "state" && message.state?.gameOver),
  ]);
  assert.equal(end1.state.winner, 1);
  assert.equal(end2.state.winner, 1);
  assert.deepEqual(end1.state.finalFive, end2.state.finalFive);
  await p1.wait(message => message.type === "match_log_saved", 5000);
  const files = fs.readdirSync(tempLogDir).filter(file => file.endsWith(".json"));
  assert.equal(files.length, 1);
  const report = JSON.parse(fs.readFileSync(path.join(tempLogDir, files[0]), "utf8"));
  assert.equal(report.winner, 1);
  assert.equal(report.finalRound, 3);
  assert.ok(report.rounds.some(round => round.actions.some(action => action.kind === "artillery")));
  assert.ok(report.finalFive.p1.length > 0);
  assert.ok(report.finalCardDistribution);
  assert.ok(Array.isArray(report.cardConservationAudits));
  assert.equal(report.finalCardDistribution.P1.total, 25);
  assert.equal(report.finalCardDistribution.P2.total, 25);
  assert.equal(report.cardConservationAudits.every(audit => audit.valid), true);
  p1.ws.close(); p2.ws.close();
});
