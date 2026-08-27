const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { WebSocketServer, WebSocket } = require("ws");
const { GameEngine, ALPHA_TURN_ORDER } = require("./game_engine");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 30 * 60 * 1000;
const ROOM_NAME_MAX = 24;
const NICKNAME_MAX = 16;
const PASSWORD_MAX = 32;
const PASSWORD_ATTEMPT_WINDOW_MS = 60_000;
const PASSWORD_ATTEMPT_LIMIT = 5;
const ROOT = __dirname;
const LOG_DIR = process.env.MATCH_LOG_DIR ? path.resolve(process.env.MATCH_LOG_DIR) : path.join(ROOT, "match_logs");
const rooms = new Map();
const passwordAttempts = new Map();

const STATIC_FILES = new Map([
  ["/", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha.html", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha-fixed.html", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha_client.js", ["alpha_client.js", "text/javascript; charset=utf-8"]],
  ["/alpha_board.css", ["alpha_board.css", "text/css; charset=utf-8"]],
  ["/game_shell.css", ["game_shell.css", "text/css; charset=utf-8"]],
  ["/local_layout.css", ["local_layout.css", "text/css; charset=utf-8"]],
  ["/online_layout.css", ["online_layout.css", "text/css; charset=utf-8"]],
  ["/alpha_ui.js", ["alpha_ui.js", "text/javascript; charset=utf-8"]],
  ["/game_engine.js", ["game_engine.js", "text/javascript; charset=utf-8"]],
  ["/local_client.js", ["local_client.js", "text/javascript; charset=utf-8"]],
  ["/local", ["index.html", "text/html; charset=utf-8"]],
  ["/local.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/icon-192.png", ["icon-192.png", "image/png"]],
  ["/icon-512.png", ["icon-512.png", "image/png"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
]);

function sendJson(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

// 房名與暱稱是顯示標籤，不是身分。移除控制／雙向文字控制字元並以 Unicode
// 字元數截斷；真正的座位所有權仍只認伺服器發出的 token。
function cleanLabel(value, maxLength, fallback = "") {
  const clean = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, maxLength).join("") || fallback;
}

function cleanNickname(value) {
  return cleanLabel(value, NICKNAME_MAX, "玩家");
}

function cleanRoomName(value, nickname) {
  return cleanLabel(value, ROOM_NAME_MAX, cleanLabel(`${nickname} 的房間`, ROOM_NAME_MAX, "等待中的房間"));
}

function cleanPassword(value) {
  const clean = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  return [...clean].slice(0, PASSWORD_MAX).join("");
}

function passwordDigest(value) {
  if (!value) return null;
  const salt = crypto.randomBytes(16);
  return { salt, digest: crypto.scryptSync(value, salt, 32) };
}

function passwordMatches(room, value) {
  if (!room.password) return true;
  const clean = cleanPassword(value);
  if (!clean) return false;
  const candidate = crypto.scryptSync(clean, room.password.salt, room.password.digest.length);
  return crypto.timingSafeEqual(candidate, room.password.digest);
}

function publicSeat(seat) {
  return seat ? { nickname: seat.nickname, connected: Boolean(seat.connected) } : null;
}

function publicRoomDetails(room) {
  return {
    code: room.code,
    name: room.name,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    hasPassword: Boolean(room.password),
    players: { 1: publicSeat(room.players[1]), 2: publicSeat(room.players[2]) },
  };
}

function lobbyRoom(room) {
  if (room.game || room.abandoned || !room.players[1]?.connected || room.players[2]) return null;
  return {
    code: room.code,
    name: room.name,
    createdBy: room.createdBy,
    status: "waiting",
    hasPassword: Boolean(room.password),
    createdAt: room.createdAt,
  };
}

function publicLobbyRooms() {
  return [...rooms.values()]
    .map(lobbyRoom)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function sendLobby(ws) {
  sendJson(ws, { type: "lobby", rooms: publicLobbyRooms(), serverNow: Date.now() });
}

function broadcastLobby() {
  const message = { type: "lobby", rooms: publicLobbyRooms(), serverNow: Date.now() };
  for (const ws of wss.clients) {
    if (!ws.alphaSession) sendJson(ws, message);
  }
}

function passwordAttemptKey(ws, code) {
  return `${ws?._socket?.remoteAddress || "unknown"}:${code}`;
}

function recentPasswordFailures(ws, code, now = Date.now()) {
  const key = passwordAttemptKey(ws, code);
  const recent = (passwordAttempts.get(key) || []).filter(time => now - time < PASSWORD_ATTEMPT_WINDOW_MS);
  if (recent.length) passwordAttempts.set(key, recent);
  else passwordAttempts.delete(key);
  return { key, recent };
}

function notePasswordFailure(ws, code) {
  const { key, recent } = recentPasswordFailures(ws, code);
  recent.push(Date.now());
  passwordAttempts.set(key, recent);
}

function clearPasswordFailures(ws, code) {
  passwordAttempts.delete(passwordAttemptKey(ws, code));
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("無法產生房號");
}

function playerToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function newSeat(pid, ws, nickname) {
  return {
    pid,
    nickname: cleanNickname(nickname),
    token: playerToken(),
    ws,
    connected: true,
    disconnectedAt: null,
    rematchWanted: false,
    processedRequests: new Map(),
  };
}

function roomStatus(room, pid) {
  const opponent = room.players[pid === 1 ? 2 : 1];
  if (room.game?.gameOver) return "finished";
  if (room.abandoned && !opponent) return "opponent_left";
  if (!room.game) return opponent?.connected ? "ready" : "waiting";
  return opponent?.connected ? "playing" : "opponent_disconnected";
}

function broadcastRoom(room) {
  room.lastActivity = Date.now();
  const serverNow = Date.now();
  const disconnectMs = GameEngine.timeoutRules().disconnectMs;
  for (const pid of [1, 2]) {
    const seat = room.players[pid];
    if (!seat?.connected) continue;
    const opponent = room.players[pid === 1 ? 2 : 1];
    sendJson(seat.ws, {
      type: "state",
      serverNow,
      roomCode: room.code,
      selfPid: pid,
      opponentConnected: Boolean(opponent?.connected),
      status: roomStatus(room, pid),
      roomMode: room.mode,
      room: publicRoomDetails(room),
      rematch: { self: Boolean(seat.rematchWanted), opponent: Boolean(opponent?.rematchWanted) },
      opponentDisconnectDeadline: opponent?.disconnectedAt
        ? opponent.disconnectedAt + disconnectMs
        : null,
      state: room.game ? room.game.visibleStateFor(pid) : null,
    });
  }
}

function maybeStart(room) {
  if (!room.game && room.players[1]?.connected && room.players[2]?.connected) {
    room.game = new GameEngine({
      matchId: crypto.randomUUID(),
      roomCode: room.code,
      turnOrderMode: room.mode,
      startingPlayer: room.mode === "fixed" ? ALPHA_TURN_ORDER.startingPlayer : undefined,
    });
    room.startedAt = Date.now();
  }
  syncTurnClock(room);
  broadcastRoom(room);
}

function syncTurnClock(room, now = Date.now()) {
  if (!room.game || room.game.gameOver) return;
  const bothConnected = [1, 2].every(pid => room.players[pid]?.connected);
  if (bothConnected) room.game.resumeTurnClock(now);
  else room.game.pauseTurnClock(now);
}

function attachSocket(ws, room, pid) {
  ws.alphaSession = { roomCode: room.code, pid };
  room.players[pid].ws = ws;
  room.players[pid].connected = true;
  room.players[pid].disconnectedAt = null;
  syncTurnClock(room);
  sendJson(ws, { type: "session", roomCode: room.code, pid, token: room.players[pid].token });
}

async function saveMatch(room) {
  if (!room.game?.gameOver || room.logSaved) return;
  room.logSaved = true;
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const safeMatch = room.game.matchId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
  const filename = `${day}_room-${room.code}_${safeMatch}.json`;
  const target = path.join(LOG_DIR, filename);
  await fs.promises.writeFile(target, JSON.stringify(room.game.fullMatchReport(), null, 2), "utf8");
  room.logPath = target;
  console.log(`Match log saved: ${target}`);
}

async function finalizeMatch(room) {
  if (!room.game?.gameOver) return;
  try {
    await saveMatch(room);
    for (const pid of [1, 2]) {
      const seat = room.players[pid];
      if (seat?.connected) sendJson(seat.ws, { type: "match_log_saved", filename: path.basename(room.logPath) });
    }
  } catch (error) {
    console.error("Failed to save match log", error);
    for (const pid of [1, 2]) {
      const seat = room.players[pid];
      if (seat?.connected) sendJson(seat.ws, { type: "error", error: "終局戰報儲存失敗，請查看伺服器終端" });
    }
  }
}

function detachPreviousSession(ws, releaseSeat = false) {
  const session = ws.alphaSession;
  if (!session) return;
  const room = rooms.get(session.roomCode);
  const seat = room?.players[session.pid];
  if (seat?.ws === ws) {
    if (releaseSeat) {
      room.players[session.pid] = null;
      if (!room.game && session.pid === 1) rooms.delete(room.code);
      else {
        if (room.game && !room.game.gameOver) room.abandoned = true;
        if (![1, 2].some(pid => room.players[pid])) rooms.delete(room.code);
        else broadcastRoom(room);
      }
    } else {
      seat.connected = false;
      seat.ws = null;
      seat.disconnectedAt = Date.now();
      syncTurnClock(room, seat.disconnectedAt);
      broadcastRoom(room);
    }
    broadcastLobby();
  }
  delete ws.alphaSession;
}

function createRoom(ws, message = {}) {
  if (blockIfInLiveGame(ws)) return;
  detachPreviousSession(ws, true);
  const code = roomCode();
  const nickname = cleanNickname(message.nickname);
  const password = cleanPassword(message.password);
  const rawMode = message.mode;
  const room = {
    code,
    // 正式 Alpha 一律固定 P1 → P2；alternating 只在開發測試明確要求時才使用。
    mode: rawMode === "alternating" ? "alternating" : "fixed",
    name: cleanRoomName(message.name, nickname),
    password: passwordDigest(password),
    createdBy: nickname,
    players: { 1: newSeat(1, ws, nickname), 2: null },
    game: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    logSaved: false,
  };
  rooms.set(code, room);
  attachSocket(ws, room, 1);
  broadcastRoom(room);
  broadcastLobby();
}

// 目前坐在哪個房間（沒有就回 null）
function currentRoom(ws) {
  return ws.alphaSession ? rooms.get(ws.alphaSession.roomCode) || null : null;
}

// 進行中的對局不准中途跳槽：那會把對手永久留在「對手已斷線」，
// 而且自己還可能回頭佔掉自己那間房的另一個座位，兩邊一起卡死。
function blockIfInLiveGame(ws) {
  const room = currentRoom(ws);
  if (room?.game && !room.game.gameOver) {
    sendJson(ws, { type: "error", error: "你正在一場進行中的對局裡，請先按「離開房間」" });
    return true;
  }
  return false;
}

function joinRoom(ws, rawCode, rawPassword, rawNickname) {
  const code = String(rawCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendJson(ws, { type: "error", error: "找不到這個房間" });
  if (blockIfInLiveGame(ws)) return;
  if (currentRoom(ws) === room) return sendJson(ws, { type: "error", error: "你已經在這個房間裡了" });
  if (room.players[2]) return sendJson(ws, { type: "error", error: "房間已有兩名玩家；原玩家請使用重連 token" });
  if (room.game) return sendJson(ws, { type: "error", error: "本房間對局已開始" });
  if (room.password) {
    const password = cleanPassword(rawPassword);
    if (!password) {
      return sendJson(ws, { type: "error", errorCode: "password_required", roomCode: code,
        error: "此房間需要密碼" });
    }
    const { recent } = recentPasswordFailures(ws, code);
    if (recent.length >= PASSWORD_ATTEMPT_LIMIT) {
      return sendJson(ws, { type: "error", errorCode: "password_rate_limited", roomCode: code,
        error: "密碼嘗試過多，請稍後再試" });
    }
    if (!passwordMatches(room, password)) {
      notePasswordFailure(ws, code);
      return sendJson(ws, { type: "error", errorCode: "password_invalid", roomCode: code,
        error: "房間密碼錯誤" });
    }
    clearPasswordFailures(ws, code);
  }
  detachPreviousSession(ws, true);
  room.players[2] = newSeat(2, ws, rawNickname);
  attachSocket(ws, room, 2);
  maybeStart(room);
  broadcastLobby();
}

function reconnect(ws, rawCode, token) {
  const code = String(rawCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendJson(ws, { type: "error", errorCode: "reconnect_failed", error: "房間已不存在" });
  const pid = [1, 2].find(candidate => room.players[candidate]?.token === token);
  if (!pid) return sendJson(ws, { type: "error", errorCode: "reconnect_failed", error: "重連 token 無效" });
  const previousRoom = currentRoom(ws);
  if (previousRoom && previousRoom !== room && blockIfInLiveGame(ws)) return;
  if (previousRoom === room && ws.alphaSession.pid === pid) {
    attachSocket(ws, room, pid);
    maybeStart(room);
    broadcastLobby();
    return;
  }
  if (previousRoom === room) {
    return sendJson(ws, { type: "error", error: "你已經在這個房間的另一個座位" });
  }
  detachPreviousSession(ws, true);
  const oldSocket = room.players[pid].ws;
  if (oldSocket && oldSocket !== ws) oldSocket.close(4001, "座位已由重新連線取代");
  attachSocket(ws, room, pid);
  maybeStart(room);
  broadcastLobby();
}

// 再來一局：雙方都按了才重開，沿用同一間房與同一組座位。
function rematch(ws) {
  const room = currentRoom(ws);
  if (!room) return sendJson(ws, { type: "error", error: "尚未加入房間" });
  if (!room.game?.gameOver) return sendJson(ws, { type: "error", error: "本局尚未結束" });
  room.players[ws.alphaSession.pid].rematchWanted = true;
  const bothReady = [1, 2].every(pid => room.players[pid]?.connected && room.players[pid].rematchWanted);
  if (bothReady) {
    room.game = new GameEngine({
      matchId: crypto.randomUUID(),
      roomCode: room.code,
      turnOrderMode: room.mode,
      startingPlayer: room.mode === "fixed" ? ALPHA_TURN_ORDER.startingPlayer : undefined,
    });
    room.startedAt = Date.now();
    room.logSaved = false;
    room.logPath = null;
    for (const pid of [1, 2]) {
      room.players[pid].rematchWanted = false;
      // 舊局的 requestId 不能沿用，否則會被當成重送而直接回覆舊結果
      room.players[pid].processedRequests.clear();
    }
    syncTurnClock(room);
  }
  broadcastRoom(room);
}

// 主動離開：把座位空出來，對手才不會卡在「等待重連」。
function leaveRoom(ws) {
  const room = currentRoom(ws);
  const session = ws.alphaSession;
  if (!room || !session) return sendJson(ws, { type: "left" });
  room.players[session.pid] = null;
  delete ws.alphaSession;
  sendJson(ws, { type: "left" });
  // 建立者在等待階段離開，房間立即關閉，不留下無主房間。
  if (!room.game && session.pid === 1) {
    rooms.delete(room.code);
    broadcastLobby();
    return;
  }
  // 房間只剩單人且對局還沒結束時，這局已經沒有意義了
  if (room.game && !room.game.gameOver) room.abandoned = true;
  const anySeat = [1, 2].some(pid => room.players[pid]);
  if (!anySeat) rooms.delete(room.code);
  else broadcastRoom(room);
  broadcastLobby();
}

async function handleAction(ws, message) {
  const session = ws.alphaSession;
  if (!session) return sendJson(ws, { type: "rejected", requestId: message.requestId, error: "尚未加入房間" });
  const room = rooms.get(session.roomCode);
  if (!room?.game) return sendJson(ws, { type: "rejected", requestId: message.requestId, error: "仍在等待另一名玩家" });
  // 伺服器收到操作時先結算已到期的回合，避免玩家在 20 秒截止後、輪詢器下一拍前偷送行動。
  const timedOut = room.game.checkTurnTimeout(Date.now());
  if (timedOut?.ok) {
    broadcastRoom(room);
    await finalizeMatch(room);
  }
  const opponentPid = session.pid === 1 ? 2 : 1;
  if (!room.players[opponentPid]?.connected) {
    return sendJson(ws, { type: "rejected", requestId: message.requestId, error: "對手已斷線，請等待重連" });
  }
  const seat = room.players[session.pid];
  const requestId = message.requestId;
  if ((typeof requestId !== "string" && typeof requestId !== "number") || String(requestId).length === 0) {
    return sendJson(ws, { type: "rejected", requestId, error: "操作缺少 requestId" });
  }
  const requestKey = String(requestId);
  const previousResponse = seat.processedRequests.get(requestKey);
  if (previousResponse) {
    sendJson(ws, previousResponse);
    return;
  }
  const intent = message.intent || {};
  let result;
  if (intent.kind === "deploy") result = room.game.deploy(session.pid, intent);
  else if (intent.kind === "move") result = room.game.move(session.pid, intent);
  else if (intent.kind === "artillery") result = room.game.artillery(session.pid, intent);
  // automatic 是伺服器逾時專用權限，絕不能接受客戶端同名欄位繞過主要行動。
  else if (intent.kind === "end_turn") result = room.game.endTurn(session.pid, { turnId: intent.turnId });
  else result = { ok: false, error: "未知操作" };
  const response = result.ok
    ? { type: "accepted", requestId }
    : { type: "rejected", requestId, error: result.error };
  seat.processedRequests.set(requestKey, response);
  if (seat.processedRequests.size > 100) {
    seat.processedRequests.delete(seat.processedRequests.keys().next().value);
  }
  if (!result.ok) {
    sendJson(ws, response);
    broadcastRoom(room);
    return;
  }
  sendJson(ws, response);
  broadcastRoom(room);
  await finalizeMatch(room);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const entry = STATIC_FILES.get(requestUrl.pathname);
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const [filename, contentType] = entry;
  try {
    const data = await fs.promises.readFile(path.join(ROOT, filename));
    res.writeHead(200, {
      "Content-Type": contentType,
      // Alpha 迭代期：HTML/JS/CSS 一律不快取。先前 CSS 被 max-age=3600 快取一小時，
      // 造成樣式修好了但玩家看到的還是舊版。圖示等二進位資源仍可快取。
      "Cache-Control": /\.(html|js|css)$/.test(filename) ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server file error");
  }
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
wss.on("connection", ws => {
  sendJson(ws, { type: "hello", message: "五連戰線 Alpha WebSocket 已連線" });
  sendLobby(ws);
  ws.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return sendJson(ws, { type: "error", error: "訊息不是合法 JSON" }); }
    if (message.type === "create_room") createRoom(ws, message);
    else if (message.type === "join_room") joinRoom(ws, message.roomCode, message.password, message.nickname);
    else if (message.type === "reconnect") reconnect(ws, message.roomCode, message.token);
    else if (message.type === "rematch") rematch(ws);
    else if (message.type === "leave_room") leaveRoom(ws);
    else if (message.type === "action") handleAction(ws, message).catch(error => {
      console.error(error);
      sendJson(ws, { type: "error", error: "伺服器處理操作時發生錯誤" });
    });
    else sendJson(ws, { type: "error", error: "未知訊息類型" });
  });
  ws.on("close", () => detachPreviousSession(ws));
  ws.on("error", error => console.warn("WebSocket error", error.message));
});

async function processRoomTimeouts(now = Date.now()) {
  const disconnectMs = GameEngine.timeoutRules().disconnectMs;
  for (const room of rooms.values()) {
    if (!room.game || room.game.gameOver) continue;

    const disconnected = [1, 2]
      .map(pid => ({ pid, seat: room.players[pid] }))
      .filter(({ seat }) => seat && !seat.connected && Number.isFinite(seat.disconnectedAt))
      .sort((a, b) => a.seat.disconnectedAt - b.seat.disconnectedAt || a.pid - b.pid);
    const expired = disconnected.find(({ seat }) => now - seat.disconnectedAt >= disconnectMs);
    if (expired) {
      room.game.forfeit(expired.pid, "disconnect_timeout");
      broadcastRoom(room);
      await finalizeMatch(room);
      continue;
    }

    syncTurnClock(room, now);
    const result = room.game.checkTurnTimeout(now);
    if (result?.ok) {
      broadcastRoom(room);
      await finalizeMatch(room);
    }
  }
}

// 250ms 只是伺服器檢查頻率；20／40 秒的正式規則仍只存在 game_engine.js。
setInterval(() => {
  processRoomTimeouts().catch(error => console.error("Failed to process game timeout", error));
}, 250).unref();

setInterval(() => {
  const now = Date.now();
  let lobbyChanged = false;
  for (const [code, room] of rooms) {
    const anyConnected = [1, 2].some(pid => room.players[pid]?.connected);
    if (!anyConnected && now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
      lobbyChanged = true;
    }
  }
  for (const [key, attempts] of passwordAttempts) {
    const recent = attempts.filter(time => now - time < PASSWORD_ATTEMPT_WINDOW_MS);
    if (recent.length) passwordAttempts.set(key, recent);
    else passwordAttempts.delete(key);
  }
  if (lobbyChanged) broadcastLobby();
}, 60_000).unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`五連戰線 Alpha Server: http://localhost:${PORT}`);
    const addresses = [];
    try {
      for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
      }
    } catch (error) {
      console.warn(`無法列出 LAN 位址：${error.message}`);
    }
    for (const address of [...new Set(addresses)]) console.log(`LAN/Tailscale candidate: http://${address}:${PORT}`);
  });
}

module.exports = {
  server, wss, rooms, saveMatch, publicLobbyRooms, cleanLabel, processRoomTimeouts,
  limits: { ROOM_NAME_MAX, NICKNAME_MAX, PASSWORD_MAX, PASSWORD_ATTEMPT_LIMIT, PASSWORD_ATTEMPT_WINDOW_MS },
};
