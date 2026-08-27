const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");
const { baseStats } = require("../game_engine");

const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "five-line-alpha-"));
process.env.MATCH_LOG_DIR = tempLogDir;
const { server, wss, rooms, limits, processRoomTimeouts } = require("../server");

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
    // 丟掉還沒被消費的舊訊息。跨階段等待時一定要先清，否則 wait() 會
    // 命中前一階段積下來的 state（例如 gameOver 還是 false 的那些）。
    drain: () => inbox.splice(0),
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
  fixedClients[fixedFirst].send({ type: "action", requestId: "fixed-first-end",
    intent: { kind: "end_turn", turnId: fixedStates[fixedFirst].turnId } });
  await fixedClients[fixedFirst].wait(message => message.type === "accepted" && message.requestId === "fixed-first-end");
  const fixedSecondTurn = await fixedClients[fixedSecond].wait(message => message.type === "state" && message.state?.current === fixedSecond);
  fixedClients[fixedSecond].send({ type: "action", requestId: "fixed-second", intent: { kind: "deploy", r: 8, c: 8, type: fixedSecondTurn.state.own.hand[0], rank: 1, turnId: fixedSecondTurn.state.turnId } });
  await fixedClients[fixedSecond].wait(message => message.type === "accepted" && message.requestId === "fixed-second");
  fixedClients[fixedSecond].send({ type: "action", requestId: "fixed-second-end",
    intent: { kind: "end_turn", turnId: fixedSecondTurn.state.turnId } });
  await fixedClients[fixedSecond].wait(message => message.type === "accepted" && message.requestId === "fixed-second-end");
  const fixedRound2 = await fixedClients[fixedFirst].wait(message => message.type === "state" && message.state?.roundNo === 2);
  assert.equal(fixedRound2.state.current, fixedFirst);
  assert.equal(fixedRound2.state.firstPlayer, fixedFirst);
  fixedP1.ws.close(); fixedP2.ws.close();

  p2.ws.close();
  const disconnected = await p1.wait(message => message.type === "state" && message.status === "opponent_disconnected");
  assert.equal(disconnected.opponentConnected, false);
  assert.equal(disconnected.state.turnClockPaused, true);
  const pausedRemaining = disconnected.state.turnRemainingMs;
  p2 = client(url);
  await p2.open();
  p2.send({ type: "reconnect", roomCode: code, token: p2Session.token });
  await p2.wait(message => message.type === "session" && message.pid === 2);
  const [reconnected1] = await Promise.all([
    p1.wait(message => message.type === "state" && message.status === "playing"),
    p2.wait(message => message.type === "state" && message.status === "playing"),
  ]);
  assert.equal(reconnected1.state.turnClockPaused, false);
  assert.ok(reconnected1.state.turnRemainingMs <= pausedRemaining
    && reconnected1.state.turnRemainingMs >= pausedRemaining - 500,
  "重連應續算斷線前剩餘時間，不得重置成完整 20 秒");

  p2.send({ type: "action", requestId: "wrong-turn", intent: { kind: "deploy", r: 8, c: 8, type: p2State.own.hand[0], rank: 1, turnId: p2State.turnId } });
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "wrong-turn")).error, /不是你的回合/);

  const count = { sword: 0, shield: 0, spear: 0 };
  p1State.own.hand.forEach(type => count[type]++);
  // 5 張手牌分 3 種兵種，必定至少有一種不足 3 張（★★ 的成本）
  const impossible = Object.keys(count).find(type => count[type] < 3);
  p1.send({ type: "action", requestId: "missing-card", intent: { kind: "deploy", r: 0, c: 0, type: impossible, rank: 2, turnId: p1State.turnId } });
  assert.match((await p1.wait(message => message.type === "rejected" && message.requestId === "missing-card")).error, /沒有足夠/);

  p1.send({ type: "action", requestId: "forged-auto-end",
    intent: { kind: "end_turn", turnId: p1State.turnId, automatic: true } });
  assert.match((await p1.wait(message => message.type === "rejected"
    && message.requestId === "forged-auto-end")).error, /請先完成部署或移動/,
  "客戶端不得偽造 automatic 權限跳過主要行動");

  const p1Deploy = { type: "action", requestId: "p1-deploy", intent: { kind: "deploy", r: 4, c: 4, type: p1State.own.hand[0], rank: 1, turnId: p1State.turnId } };
  p1.send(p1Deploy);
  p1.send(p1Deploy);
  p1.send({ type: "action", requestId: "p1-rapid-second", intent: { kind: "deploy", r: 4, c: 3, type: p1State.own.hand[0], rank: 1, turnId: p1State.turnId } });
  await p1.wait(message => message.type === "accepted" && message.requestId === "p1-deploy");
  assert.match((await p1.wait(message => message.type === "rejected" && message.requestId === "p1-rapid-second")).error,
    /本回合已完成部署/);
  p1.send({ type: "action", requestId: "p1-end", intent: { kind: "end_turn", turnId: p1State.turnId } });
  await p1.wait(message => message.type === "accepted" && message.requestId === "p1-end");
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
  assert.match((await p2.wait(message => message.type === "rejected" && message.requestId === "p2-rapid-second")).error,
    /本回合已完成部署/);
  p2.send({ type: "action", requestId: "p2-end", intent: { kind: "end_turn", turnId: p2Turn.state.turnId } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "p2-end");
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
  engine.beginTurnClock();
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
  const winningTurn = engine.turnId;
  p1.send({ type: "action", requestId: "winning-end", intent: { kind: "end_turn", turnId: winningTurn } });
  await p1.wait(message => message.type === "accepted" && message.requestId === "winning-end");
  p2.send({ type: "action", requestId: "final-reply", intent: { kind: "deploy", r: 8, c: 8, type: "shield", rank: 1, turnId: engine.turnId } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "final-reply");
  const finalTurn = engine.turnId;
  p2.send({ type: "action", requestId: "final-end", intent: { kind: "end_turn", turnId: finalTurn } });
  await p2.wait(message => message.type === "accepted" && message.requestId === "final-end");
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

test("進行中的對局不准跳槽；結束後可用同一房再來一局；主動離開對手看得到", async t => {
  const listener = require("node:http").createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.close();
    await new Promise(resolve => server.close(resolve));
    listener.close();
  });
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const a = client(url), b = client(url), c = client(url);
  await Promise.all([a.open(), b.open(), c.open()]);

  a.send({ type: "create_room" });
  const roomA = (await a.wait(m => m.type === "session")).roomCode;
  b.send({ type: "join_room", roomCode: roomA });
  await b.wait(m => m.type === "session");
  await Promise.all([a.wait(m => m.type === "state" && m.state), b.wait(m => m.type === "state" && m.state)]);

  // ---- 1) 對局進行中不准跳到別的房，也不准另開新房 ----
  c.send({ type: "create_room" });
  const roomCSession = await c.wait(m => m.type === "session");
  const roomC = roomCSession.roomCode;
  b.send({ type: "join_room", roomCode: roomC });
  const jumpError = await b.wait(m => m.type === "error");
  assert.match(jumpError.error, /進行中的對局/,
    "對局中跳槽會把對手永久留在「對手已斷線」，必須擋下來");
  b.send({ type: "create_room" });
  assert.match((await b.wait(m => m.type === "error")).error, /進行中的對局/);
  b.send({ type: "reconnect", roomCode: roomC, token: roomCSession.token });
  assert.match((await b.wait(m => m.type === "error")).error, /進行中的對局/,
    "持有其他房間 token 也不能用重連繞過跳槽守衛");
  // 已在進行中的對局裡時，連回原房也是同一道守衛先攔（順序正確）
  b.send({ type: "join_room", roomCode: roomA });
  assert.match((await b.wait(m => m.type === "error")).error, /進行中的對局/);
  // 「已經在這個房間」要用還沒開局的房才驗得到：C 是 roomC 的 P1
  c.send({ type: "join_room", roomCode: roomC });
  assert.match((await c.wait(m => m.type === "error")).error, /已經在這個房間/);
  // 座位沒有被動到
  const stillB = await (async () => { b.send({ type: "rematch" }); return b.wait(m => m.type === "error"); })();
  assert.match(stillB.error, /尚未結束/, "本局還沒結束就不該能再戰");
  assert.equal(rooms.get(roomA).players[2].connected, true, "B 仍然坐在原本的房間");

  // ---- 2) 用消極判負快速結束，再測再來一局 ----
  // 直接讀房間裡的引擎取 turnId 與手牌：客戶端 inbox 可能還積著前面那些
  // 錯誤測試觸發的舊 state，用它去組 intent 會拿到過期的 turnId。
  const game = () => rooms.get(roomA).game;
  for (let round = 1; round <= 3; round++) {
    for (const [player, pid] of [[a, 1], [b, 2]]) {
      const engine = game();
      const accepted = player.wait(m => m.type === "accepted" || m.type === "rejected");
      player.send({ type: "action", requestId: `q${round}-${pid}`,
        intent: { kind: "deploy", r: pid === 1 ? 0 : 8, c: round - 1,
          type: engine.players[pid - 1].hand[0], rank: 1, turnId: engine.turnId } });
      const reply = await accepted;
      assert.equal(reply.type, "accepted", `第 ${round} 輪 P${pid} 部署應該成功：${reply.error || ""}`);
      const endReply = player.wait(m => (m.type === "accepted" || m.type === "rejected")
        && m.requestId === `q${round}-${pid}-end`);
      player.send({ type: "action", requestId: `q${round}-${pid}-end`,
        intent: { kind: "end_turn", turnId: engine.turnId } });
      const ended = await endReply;
      assert.equal(ended.type, "accepted", `第 ${round} 輪 P${pid} 結束回合應該成功：${ended.error || ""}`);
    }
  }
  assert.equal(game().gameOver, true, "連續 3 輪零交戰應該判消極雙敗");
  assert.equal(game().winner, "double_loss");

  // 單方請求不會重開
  a.drain(); b.drain();
  const bSees = b.wait(m => m.type === "state" && m.rematch?.opponent === true);
  a.send({ type: "rematch" });
  const seen = await bSees;
  assert.deepEqual(seen.rematch, { self: false, opponent: true }, "對手要看得到請求");
  assert.equal(game().gameOver, true, "只有一方要求時不得重開");

  // 雙方都要求才重開，而且沿用同一間房與同一組座位
  a.drain();
  const fresh = a.wait(m => m.type === "state" && m.state?.gameOver === false);
  b.send({ type: "rematch" });
  const restarted = await fresh;
  assert.equal(restarted.roomCode, roomA, "房號不變");
  assert.equal(restarted.selfPid, 1, "座位不變");
  assert.equal(restarted.state.roundNo, 1);
  assert.equal(restarted.state.board.flat().filter(Boolean).length, 0, "棋盤清空");
  assert.deepEqual(restarted.rematch, { self: false, opponent: false }, "重開後意願要清掉");
  // 舊局的 requestId 不可以沿用舊回應
  assert.equal(rooms.get(roomA).players[1].processedRequests.size, 0);

  // ---- 3) 主動離開：對手要能分辨「離開」與「暫時斷線」 ----
  a.drain(); b.drain();
  b.send({ type: "leave_room" });
  await b.wait(m => m.type === "left");
  const abandoned = await a.wait(m => m.type === "state" && m.status === "opponent_left");
  assert.equal(abandoned.status, "opponent_left");
  assert.equal(rooms.get(roomA).players[2], null, "座位要真的空出來");
  a.ws.close(); b.ws.close(); c.ws.close();
});

test("階段三大廳只列等待房，保護密碼與 token，並限制密碼猜測", async t => {
  rooms.clear();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.close();
    await new Promise(resolve => server.close(resolve));
    rooms.clear();
  });
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const observer = client(url), host = client(url), guest = client(url), attacker = client(url);
  await Promise.all([observer.open(), host.open(), guest.open(), attacker.open()]);
  const initialLobby = await observer.wait(message => message.type === "lobby");
  assert.deepEqual(initialLobby.rooms, []);

  const rawRoomName = `\u202e戰略\u0000房-${"長".repeat(30)}`;
  const secret = "霧鎖-7788";
  host.send({ type: "create_room", name: rawRoomName, password: secret,
    nickname: "<img src=x onerror=1>房主" });
  const hostSession = await host.wait(message => message.type === "session");
  const code = hostSession.roomCode;
  const waitingState = await host.wait(message => message.type === "state" && message.status === "waiting");
  const listed = await observer.wait(message => message.type === "lobby"
    && message.rooms.some(room => room.code === code));
  const card = listed.rooms.find(room => room.code === code);
  assert.deepEqual(Object.keys(card).sort(),
    ["code", "createdAt", "createdBy", "hasPassword", "name", "status"]);
  assert.equal(card.status, "waiting");
  assert.equal(card.hasPassword, true);
  assert.ok([...card.name].length <= limits.ROOM_NAME_MAX);
  assert.doesNotMatch(card.name, /[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/);
  assert.equal(JSON.stringify(card).includes(secret), false, "大廳卡不得含原始密碼");
  assert.equal(JSON.stringify(card).includes(hostSession.token), false, "大廳卡不得含重連 token");
  assert.equal(JSON.stringify(waitingState.room).includes(hostSession.token), false,
    "房內公開資料也不得夾帶 token");
  assert.equal(Buffer.isBuffer(rooms.get(code).password.salt), true, "伺服器保存隨機鹽值");
  assert.equal(Buffer.isBuffer(rooms.get(code).password.digest), true, "伺服器只保存加鹽密碼摘要");
  assert.equal(rooms.get(code).players[1].token, hostSession.token, "座位身分仍以 token 為準");
  assert.equal(rooms.get(code).players[1].nickname, card.createdBy, "暱稱只作公開標籤");

  guest.send({ type: "join_room", roomCode: code, nickname: "挑戰者" });
  assert.equal((await guest.wait(message => message.errorCode === "password_required")).error,
    "此房間需要密碼");
  guest.send({ type: "join_room", roomCode: code, password: "錯誤", nickname: "挑戰者" });
  assert.equal((await guest.wait(message => message.errorCode === "password_invalid")).error,
    "房間密碼錯誤");
  assert.equal(rooms.get(code).players[2], null, "密碼錯誤不能占座");
  guest.send({ type: "join_room", roomCode: code, password: secret, nickname: "挑戰者" });
  await guest.wait(message => message.type === "session" && message.roomCode === code);
  await Promise.all([
    host.wait(message => message.type === "state" && message.state),
    guest.wait(message => message.type === "state" && message.state),
  ]);
  const afterStart = await observer.wait(message => message.type === "lobby"
    && !message.rooms.some(room => room.code === code));
  assert.equal(afterStart.rooms.some(room => room.code === code), false,
    "已開始對局不得出現在等待房列表");

  const waitingHost = client(url);
  await waitingHost.open();
  waitingHost.send({ type: "create_room", name: "稍候刪除", nickname: "短暫房主" });
  const waitingSession = await waitingHost.wait(message => message.type === "session");
  const waitingCode = waitingSession.roomCode;
  await observer.wait(message => message.type === "lobby"
    && message.rooms.some(room => room.code === waitingCode));
  waitingHost.send({ type: "leave_room" });
  await waitingHost.wait(message => message.type === "left");
  await observer.wait(message => message.type === "lobby"
    && !message.rooms.some(room => room.code === waitingCode));
  assert.equal(rooms.has(waitingCode), false, "建立者離開等待房後要立即刪除房間");

  const rateHost = client(url);
  await rateHost.open();
  rateHost.send({ type: "create_room", name: "防猜密碼", password: "正確密碼", nickname: "守門人" });
  const rateCode = (await rateHost.wait(message => message.type === "session")).roomCode;
  for (let attempt = 0; attempt < limits.PASSWORD_ATTEMPT_LIMIT; attempt++) {
    attacker.send({ type: "join_room", roomCode: rateCode, password: `錯誤-${attempt}` });
    await attacker.wait(message => message.errorCode === "password_invalid" && message.roomCode === rateCode);
  }
  attacker.send({ type: "join_room", roomCode: rateCode, password: "仍然錯誤" });
  assert.equal((await attacker.wait(message => message.errorCode === "password_rate_limited"
    && message.roomCode === rateCode)).error, "密碼嘗試過多，請稍後再試");
  assert.equal(rooms.get(rateCode).players[2], null, "限流後仍不能占座");

  observer.ws.close(); host.ws.close(); guest.ws.close(); attacker.ws.close();
  waitingHost.ws.close(); rateHost.ws.close();
});

test("階段四伺服器權威處理回合逾時、斷線暫停與 40 秒判離", async t => {
  rooms.clear();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.close();
    await new Promise(resolve => server.close(resolve));
    rooms.clear();
  });
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const p1 = client(url), p2 = client(url);
  await Promise.all([p1.open(), p2.open()]);

  p1.send({ type: "create_room", nickname: "計時房主" });
  const code = (await p1.wait(message => message.type === "session")).roomCode;
  p2.send({ type: "join_room", roomCode: code, nickname: "計時來賓" });
  await p2.wait(message => message.type === "session");
  const [initial1, initial2] = await Promise.all([
    p1.wait(message => message.type === "state" && message.state),
    p2.wait(message => message.type === "state" && message.state),
  ]);
  assert.deepEqual(initial1.state.timeoutRules, { turnMs: 20_000, disconnectMs: 40_000 });
  assert.deepEqual(initial2.state.timeoutRules, initial1.state.timeoutRules);
  assert.equal(typeof initial1.serverNow, "number");
  assert.ok(initial1.state.turnDeadline > initial1.serverNow);

  const room = rooms.get(code);
  const oldTurnId = room.game.turnId;
  const forcedNow = Date.now() + 1_000;
  room.game.turnDeadline = forcedNow;
  await processRoomTimeouts(forcedNow);
  const autoEnded = await p1.wait(message => message.type === "state"
    && message.state?.turnId === oldTurnId + 1);
  assert.equal(autoEnded.state.current, 2, "伺服器在截止時間自動交棒");
  assert.ok(autoEnded.state.logs.some(entry => /回合逾時.*自動結束回合/.test(entry.text)));

  p2.ws.close();
  const disconnected = await p1.wait(message => message.type === "state"
    && message.status === "opponent_disconnected");
  const disconnectedAt = room.players[2].disconnectedAt;
  const pausedRemaining = room.game.turnRemainingMs;
  assert.equal(disconnected.state.turnClockPaused, true);
  assert.equal(disconnected.state.turnDeadline, null);
  assert.equal(disconnected.opponentDisconnectDeadline,
    disconnectedAt + disconnected.state.timeoutRules.disconnectMs);

  await processRoomTimeouts(disconnectedAt + 39_999);
  assert.equal(room.game.gameOver, false, "40 秒前不得提早判離");
  assert.equal(room.game.turnRemainingMs, pausedRemaining, "斷線等待不能偷吃回合時間");

  await processRoomTimeouts(disconnectedAt + 40_000);
  const finished = await p1.wait(message => message.type === "state" && message.state?.gameOver);
  assert.equal(finished.state.winner, 1);
  assert.equal(finished.state.endReason, "disconnect_timeout");
  assert.equal(finished.state.forfeitedPlayer, 2);
  assert.equal(finished.state.turnDeadline, null);
});
