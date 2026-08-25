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
const ROOT = __dirname;
const LOG_DIR = process.env.MATCH_LOG_DIR ? path.resolve(process.env.MATCH_LOG_DIR) : path.join(ROOT, "match_logs");
const rooms = new Map();

const STATIC_FILES = new Map([
  ["/", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha.html", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha-fixed.html", ["alpha.html", "text/html; charset=utf-8"]],
  ["/alpha_client.js", ["alpha_client.js", "text/javascript; charset=utf-8"]],
  ["/alpha_board.css", ["alpha_board.css", "text/css; charset=utf-8"]],
  ["/game_shell.css", ["game_shell.css", "text/css; charset=utf-8"]],
  ["/local_layout.css", ["local_layout.css", "text/css; charset=utf-8"]],
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

function newSeat(pid, ws) {
  return {
    pid,
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
  for (const pid of [1, 2]) {
    const seat = room.players[pid];
    if (!seat?.connected) continue;
    const opponent = room.players[pid === 1 ? 2 : 1];
    sendJson(seat.ws, {
      type: "state",
      roomCode: room.code,
      selfPid: pid,
      opponentConnected: Boolean(opponent?.connected),
      status: roomStatus(room, pid),
      roomMode: room.mode,
      rematch: { self: Boolean(seat.rematchWanted), opponent: Boolean(opponent?.rematchWanted) },
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
  broadcastRoom(room);
}

function attachSocket(ws, room, pid) {
  ws.alphaSession = { roomCode: room.code, pid };
  room.players[pid].ws = ws;
  room.players[pid].connected = true;
  room.players[pid].disconnectedAt = null;
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

function detachPreviousSession(ws) {
  const session = ws.alphaSession;
  if (!session) return;
  const room = rooms.get(session.roomCode);
  const seat = room?.players[session.pid];
  if (seat?.ws === ws) {
    seat.connected = false;
    seat.ws = null;
    seat.disconnectedAt = Date.now();
    broadcastRoom(room);
  }
  delete ws.alphaSession;
}

function createRoom(ws, rawMode) {
  if (blockIfInLiveGame(ws)) return;
  detachPreviousSession(ws);
  const code = roomCode();
  const room = {
    code,
    // 正式 Alpha 一律固定 P1 → P2；alternating 只在開發測試明確要求時才使用。
    mode: rawMode === "alternating" ? "alternating" : "fixed",
    players: { 1: newSeat(1, ws), 2: null },
    game: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    logSaved: false,
  };
  rooms.set(code, room);
  attachSocket(ws, room, 1);
  broadcastRoom(room);
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

function joinRoom(ws, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendJson(ws, { type: "error", error: "找不到這個房間" });
  if (blockIfInLiveGame(ws)) return;
  if (currentRoom(ws) === room) return sendJson(ws, { type: "error", error: "你已經在這個房間裡了" });
  if (room.players[2]) return sendJson(ws, { type: "error", error: "房間已有兩名玩家；原玩家請使用重連 token" });
  if (room.game) return sendJson(ws, { type: "error", error: "本房間對局已開始" });
  detachPreviousSession(ws);
  room.players[2] = newSeat(2, ws);
  attachSocket(ws, room, 2);
  maybeStart(room);
}

function reconnect(ws, rawCode, token) {
  const code = String(rawCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendJson(ws, { type: "error", error: "房間已不存在" });
  const pid = [1, 2].find(candidate => room.players[candidate]?.token === token);
  if (!pid) return sendJson(ws, { type: "error", error: "重連 token 無效" });
  detachPreviousSession(ws);
  const oldSocket = room.players[pid].ws;
  if (oldSocket && oldSocket !== ws) oldSocket.close(4001, "座位已由重新連線取代");
  attachSocket(ws, room, pid);
  maybeStart(room);
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
  // 房間只剩單人且對局還沒結束時，這局已經沒有意義了
  if (room.game && !room.game.gameOver) room.abandoned = true;
  broadcastRoom(room);
}

async function handleAction(ws, message) {
  const session = ws.alphaSession;
  if (!session) return sendJson(ws, { type: "rejected", requestId: message.requestId, error: "尚未加入房間" });
  const room = rooms.get(session.roomCode);
  if (!room?.game) return sendJson(ws, { type: "rejected", requestId: message.requestId, error: "仍在等待另一名玩家" });
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
  else if (intent.kind === "artillery") result = room.game.artillery(session.pid, intent);
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
  if (room.game.gameOver) {
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
  ws.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return sendJson(ws, { type: "error", error: "訊息不是合法 JSON" }); }
    if (message.type === "create_room") createRoom(ws, message.mode);
    else if (message.type === "join_room") joinRoom(ws, message.roomCode);
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

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = [1, 2].some(pid => room.players[pid]?.connected);
    if (!anyConnected && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
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

module.exports = { server, wss, rooms, saveMatch };
