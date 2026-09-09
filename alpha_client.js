(() => {
  const UI = globalThis.AlphaUI;
  const design = globalThis.BattleDesign.mount({ online: true });
  const { NAMES } = UI;
  const $ = selector => document.querySelector(selector);
  const boardEl = $("#board");
  const logEl = $("#log");
  // 正式 Alpha 一律固定 P1 → P2 → combat。alternating 只保留給開發測試，
  // 必須明確在網址加上 ?turnOrder=alternating 才會啟用，一般入口不會碰到。
  const requestedMode =
    new URLSearchParams(location.search).get("turnOrder") === "alternating" ? "alternating" : "fixed";
  const REQUEST_TIMEOUT_MS = 10_000;          // 專案擁有者指定：等待伺服器狀態最多 10 秒
  if (requestedMode === "alternating") {
    document.title = "五連戰線｜交替先手（開發測試）";
    document.querySelectorAll(".lobbyBrand h1, .gameTop h1")
      .forEach(title => { title.textContent = "五連戰線｜交替先手（開發測試）"; });
    $("#createBtn").textContent = "建立交替先手房間（非正式規則）";
  }
  let socket;
  let connected = false;
  let awaitingState = false;
  let stateSyncTimer = null;
  let reconnectSession = null;
  let roomCode = null;
  let selfPid = null;
  let rematchState = { self: false, opponent: false };
  let moveFrom = null;                 // 手牌用盡時，已選好要移動的棋子座標
  let opponentConnected = false;
  let roomStatus = "none";
  let roomInfo = null;
  let lobbyRooms = [];
  let lobbyClockDelta = 0;
  let gameClockDelta = 0;
  let opponentDisconnectDeadline = null;
  let pendingJoinCode = null;
  let pendingJoinName = "";
  let state = null;
  let selectedType = null;
  let selectedRank = 1;
  let artilleryMode = false;
  let pendingRequest = false;
  let pendingRequestTimer = null;
  let pendingTimedOut = false;
  let notice = "";
  let hoverType = null;                       // 滑鼠正在預覽的兵種
  let resultReportOpen = false;
  let combatMatchId = null;
  let lastCombatId = null;
  let pendingCombat = null;
  const NICKNAME_KEY = "five-line-alpha-nickname";

  // 兵種數值一律取自 server 送來的 unitCatalog；尚未進房時退回同一份 game_engine.js
  // 的靜態目錄，兩者是同一個來源，不會漂移。
  const catalog = () => (state && state.unitCatalog)
    || globalThis.FiveLineEngine?.GameEngine.unitCatalog()
    || null;
  const cardLine = (label, cards) => cards
    ? `${label} 牌庫 ${cards.deck}／手牌 ${cards.hand}／冷卻 ${cards.cooldown}／場上綁定 ${cards.boardBoundCards}／總數 ${cards.total}${cards.valid ? "" : " ⚠"}`
    : `${label}：尚無資料`;

  function sessionKey() { return `five-line-alpha-session-${requestedMode}`; }
  function saveSession(message) {
    reconnectSession = { roomCode: message.roomCode, token: message.token, pid: message.pid };
    try { localStorage.setItem(sessionKey(), JSON.stringify(reconnectSession)); }
    catch { /* 本次頁面仍保留重連資料。 */ }
  }
  function loadSession() {
    if (reconnectSession) return reconnectSession;
    try { return JSON.parse(localStorage.getItem(sessionKey()) || "null"); }
    catch { return null; }
  }

  function loadNickname() {
    try { return localStorage.getItem(NICKNAME_KEY) || ""; }
    catch { return ""; }
  }

  function nickname() {
    const value = $("#nicknameInput").value.trim() || "玩家";
    try { localStorage.setItem(NICKNAME_KEY, value); }
    catch { /* 瀏覽器停用儲存時仍可用本次輸入 */ }
    return value;
  }

  function send(message) {
    if (!connected) return;
    socket.send(JSON.stringify(message));
  }

  function cancelPendingRequestTimeout() {
    if (pendingRequestTimer !== null) clearTimeout(pendingRequestTimer);
    pendingRequestTimer = null;
  }

  function clearPendingRequest() {
    pendingRequest = false;
    cancelPendingRequestTimeout();
  }

  function clearStateSync() {
    awaitingState = false;
    if (stateSyncTimer !== null) clearTimeout(stateSyncTimer);
    stateSyncTimer = null;
  }

  function requestCurrentState() {
    const saved = loadSession();
    if (!connected || !saved?.roomCode || !saved?.token) return;
    clearStateSync();
    awaitingState = true;
    design.clearDraft();
    send({ type: "reconnect", roomCode: saved.roomCode, token: saved.token });
    stateSyncTimer = setTimeout(() => {
      stateSyncTimer = null;
      if (awaitingState) socket.close(); // 重新建立正常連線，不重送結果不明的行動。
    }, REQUEST_TIMEOUT_MS);
  }

  function schedulePendingRequestTimeout() {
    cancelPendingRequestTimeout();
    pendingRequestTimer = setTimeout(() => {
      if (!pendingRequest) return;
      pendingRequest = false;
      pendingRequestTimer = null;
      pendingTimedOut = true;
      notice = `伺服器超過 ${REQUEST_TIMEOUT_MS / 1000} 秒沒有回傳新狀態；尚未確認結果，正在同步最新局面。`;
      requestCurrentState();
      render();
    }, REQUEST_TIMEOUT_MS);
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener("open", () => {
      connected = true;
      notice = "";
      requestCurrentState();
      if (pendingRequest) schedulePendingRequestTimeout();
      render();
    });
    socket.addEventListener("close", () => {
      connected = false;
      clearStateSync();
      // 斷線期間不倒數；重連後若仍在等待，再重新給完整 10 秒。
      cancelPendingRequestTimeout();
      notice = "與伺服器斷線，正在嘗試重新連線…";
      render();
      setTimeout(connect, 1800);
    });
    socket.addEventListener("error", () => { notice = "WebSocket 連線錯誤"; render(); });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.type === "lobby") {
        lobbyRooms = Array.isArray(message.rooms) ? message.rooms : [];
        lobbyClockDelta = Date.now() - Number(message.serverNow || Date.now());
      } else if (message.type === "session") {
        saveSession(message);
        roomCode = message.roomCode;
        selfPid = message.pid;
        notice = "";
        closePasswordPrompt();
        $("#roomPasswordInput").value = "";
        $("#directPasswordInput").value = "";
      } else if (message.type === "state") {
        const previousTurnId = state?.turnId;
        const wasSyncing = awaitingState;
        clearStateSync();
        gameClockDelta = Date.now() - Number(message.serverNow || Date.now());
        opponentDisconnectDeadline = Number(message.opponentDisconnectDeadline) || null;
        roomCode = message.roomCode;
        selfPid = message.selfPid;
        opponentConnected = message.opponentConnected;
        roomStatus = message.status;
        roomInfo = message.room || null;
        state = message.state;
        if (wasSyncing) {
          combatPlayback.reset();
          combatMatchId = state?.matchId || null;
          lastCombatId = state?.lastCombat?.id || null;
          pendingCombat = null;
          design.clearDraft(); design.clearInspect();
          selectedType = null; selectedRank = 1; hoverType = null; artilleryMode = false; moveFrom = null;
        }
        rematchState = message.rematch || { self: false, opponent: false };
        clearPendingRequest();
        if (pendingTimedOut) notice = "";
        pendingTimedOut = false;
        if (!state?.gameOver) resultReportOpen = false;
        if (!state || state.current !== selfPid || state.turnId !== previousTurnId) {
          selectedType = null; selectedRank = 1; hoverType = null; artilleryMode = false; moveFrom = null;
        } else if (state.deploymentCommitted) {
          selectedType = null; selectedRank = 1; moveFrom = null;
        }
      } else if (message.type === "rejected" || message.type === "error") {
        clearPendingRequest();
        pendingTimedOut = false;
        if (message.errorCode === "reconnect_failed") {
          clearStateSync(); reconnectSession = null;
          roomCode = null; selfPid = null; state = null; roomStatus = "none"; roomInfo = null;
          opponentConnected = false; opponentDisconnectDeadline = null;
          combatPlayback.reset(); combatMatchId = null; lastCombatId = null; pendingCombat = null;
          try { localStorage.removeItem(sessionKey()); }
          catch { /* 無儲存權限時沒有舊工作階段可移除 */ }
          notice = message.error;
        } else if (["password_required", "password_invalid", "password_rate_limited"].includes(message.errorCode)) {
          const listedRoom = lobbyRooms.find(room => room.code === message.roomCode);
          openPasswordPrompt(message.roomCode, listedRoom?.name || pendingJoinName || `房號 ${message.roomCode}`,
            message.errorCode === "password_required" ? "" : message.error);
        } else {
          notice = message.error;
        }
      } else if (message.type === "accepted") {
        notice = "";
      } else if (message.type === "left") {
        clearStateSync(); reconnectSession = null;
        // 主動離開：把本機的房間狀態清乾淨，才不會拿舊房的 state 去比對新的 selfPid
        roomCode = null; selfPid = null; state = null; roomStatus = null; roomInfo = null;
        opponentConnected = false; opponentDisconnectDeadline = null;
        rematchState = { self: false, opponent: false };
        clearPendingRequest(); pendingTimedOut = false;
        artilleryMode = false; selectedType = null;
        resultReportOpen = false;
        combatPlayback.reset(); combatMatchId = null; lastCombatId = null; pendingCombat = null;
        try { localStorage.removeItem(sessionKey()); }
        catch { /* 無儲存權限時沒有待清除的工作階段 */ }
        notice = "已離開房間。";
        closePasswordPrompt();
      } else if (message.type === "match_log_saved") {
        notice = `終局戰報已儲存：${message.filename}`;
      }
      render();
    });
  }

  // 移動落點直接使用伺服器提供的合法清單，前端只做選取。
  function moveMode() {
    return Boolean(state && !state.gameOver && !state.deploymentCommitted && state.legalMoves?.length);
  }

  function turnBlockReason() {
    if (!connected) return "尚未連上伺服器";
    if (awaitingState) return "正在同步最新局面";
    if (!state) return "等待正式遊戲狀態";
    if (pendingCombat || combatPlayback.active()) return "戰鬥演出中";
    if (pendingRequest) return "等待伺服器回應";
    if (state.gameOver) return "本局已結束";
    if (!opponentConnected) return "對手已斷線";
    if (state.current !== selfPid) return "不是你的回合";
    return "";
  }

  function ownTurn() {
    return turnBlockReason() === "";
  }

  function artilleryReason() {
    return UI.artilleryDisabledReason({
      turnReason: turnBlockReason(),
      remaining: state?.artillery?.[selfPid],
      usedThisTurn: state?.artilleryUsedThisTurn,
    });
  }

  function endTurnReason() {
    return UI.endTurnDisabledReason({
      turnReason: turnBlockReason(),
      deploymentCommitted: state?.deploymentCommitted,
      canAct: state?.canAct,
    });
  }

  function placementBlockReason() {
    return turnBlockReason() || (state?.deploymentCommitted
      ? "本回合已完成部署或移動，請炮擊或結束回合"
      : "");
  }

  function rematchControl() {
    if (!state?.gameOver) return { disabled: true, text: "再來一局｜本局尚未結束" };
    if (!connected) return { disabled: true, text: "再來一局｜等待伺服器連線" };
    if (rematchState.self) return { disabled: true, text: "已請求｜等待對手" };
    if (!opponentConnected) return { disabled: true, text: "再來一局｜對手未連線" };
    return { disabled: false, text: rematchState.opponent ? "接受對手的再戰邀請" : "再來一局" };
  }

  function sendIntent(intent) {
    if (!ownTurn()) return;
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    design.clearDraft();
    pendingRequest = true;
    pendingTimedOut = false;
    send({ type: "action", requestId, intent: { ...intent, turnId: state.turnId } });
    schedulePendingRequestTimeout();
    render();
  }

  function confirmAction(intent) {
    if (!ownTurn() || (intent.kind === "artillery" ? artilleryReason() : placementBlockReason())) return;
    if (intent.kind === "artillery") artilleryMode = false;
    sendIntent(intent);
  }

  function cancelSelection() {
    if (turnBlockReason()) return;
    design.clearDraft(); design.clearInspect();
    selectedType = null; selectedRank = 1; hoverType = null;
    artilleryMode = false; moveFrom = null; hoverCell = null; notice = "";
    render();
  }

  function onCell(r, c) {
    if (!state) return;
    const unit = state.board[r][c];
    if (unit) { design.inspect(unit); renderCardDetail(); }
    if (!ownTurn()) return;
    if (artilleryMode) {
      design.setDraft({ kind: "artillery", r, c }, state); notice = ""; render(); return;
    }
    if (state.deploymentCommitted) return;
    if (moveMode()) {
      if (unit?.pid === selfPid) {
        design.clearDraft(); moveFrom = [r, c]; notice = ""; render(); return;
      }
      const legal = moveFrom && state.legalMoves.some(move =>
        move.from[0] === moveFrom[0] && move.from[1] === moveFrom[1] && move.to[0] === r && move.to[1] === c);
      if (!legal) { notice = "請選擇自己棋子旁標示的合法空格。"; render(); return; }
      design.setDraft({ kind: "move", r: moveFrom[0], c: moveFrom[1], toR: r, toC: c }, state);
    } else {
      if (unit) { design.clearDraft(); render(); return; }
      if (!selectedType) { notice = "請先選擇自己的手牌。"; render(); return; }
      design.clearInspect();
      design.setDraft({ kind: "deploy", r, c, type: selectedType, rank: selectedRank }, state);
    }
    notice = ""; render();
  }

  // 每次重繪都依當下容器重算棋盤尺寸，不倚賴 ResizeObserver 的觸發時機
  const sizeBoard = UI.autoSizeBoard(document.querySelector("#board"), document.querySelector(".boardWrap"));
  const combatPlayback = UI.createCombatPlayback({
    boardEl,
    stageEl: $("#combatStage"),
    svgEl: $("#combatLayer"),
    piecesEl: $("#combatPieces"),
    labelEl: $("#combatStepLabel"),
    skipButton: $("#skipCombatBtn"),
    onFinish: () => render(),
  });

  function syncCombatCue() {
    if (!state) {
      combatPlayback.reset();
      combatMatchId = null; lastCombatId = null; pendingCombat = null;
      return;
    }
    if (combatMatchId !== state.matchId) {
      combatPlayback.reset();
      combatMatchId = state.matchId;
      lastCombatId = state.lastCombat?.id || null; // 首次進房／重連不重播舊輪次
      pendingCombat = null;
      return;
    }
    const next = state.lastCombat;
    if (!next || next.id === lastCombatId || next.id === pendingCombat?.id) return;
    pendingCombat = next;
  }

  function startPendingCombat() {
    if (!pendingCombat || combatPlayback.active()) return;
    const next = pendingCombat;
    pendingCombat = null;
    lastCombatId = next.id;
    if (!combatPlayback.play(next)) renderResultOverlay();
  }

  function renderBoard() {
    sizeBoard();
    design.renderBoard(state, {
      onCell,
      onHover: cell => { hoverCell = cell; renderForecast(); },
    });
  }

  function renderHand() {
    design.renderHand({
      view: state, selectedType, selectedRank, blocked: placementBlockReason(),
      onSelect: type => {
        selectedType = type; selectedRank = 1; artilleryMode = false;
        moveFrom = null; hoverType = null; notice = ""; render();
      },
      onRank: rank => { selectedRank = rank; hoverType = null; notice = ""; render(); },
      onInspect: type => { hoverType = type; renderCardDetail(); },
    });
    renderCardDetail();
  }

  // 炮擊點選後維持預覽；交戰演出仍只讀取伺服器的結算事件。
  let hoverCell = null;
  function renderForecast() {
    const layer = $("#forecastLayer");
    layer.innerHTML = "";
    if (!state || pendingCombat || combatPlayback.active()) return;
    const draft = design.draft();
    const target = draft?.kind === "artillery" ? [draft.r, draft.c] : hoverCell;
    if (artilleryMode && ownTurn() && target && state.artilleryRules) {
      UI.drawArtillery(layer, boardEl,
        UI.forecastArtillery(state.board, ...target, state.artilleryRules, selfPid));
    }
  }

  function renderCardDetail() {
    const type = hoverType || selectedType;
    design.detail(type, type === selectedType ? selectedRank : 1, catalog(), state?.eliteCardCost);
  }

  function renderLogs() {
    logEl.innerHTML = "";
    for (const item of state?.logs || []) {
      const div = document.createElement("div");
      div.className = item.kind;
      div.textContent = `R${item.round}｜${item.text}`;
      logEl.prepend(div);
    }
  }

  function renderTurnVisual() {
    const activePid = state && !state.gameOver ? Number(state.current) : 0;
    const turnSection = document.querySelector(".turnSection");
    const turnText = $("#turnText");
    const handPanel = document.querySelector(".handPanel");
    for (const pid of [1, 2]) {
      turnSection?.classList.toggle(`active-p${pid}`, activePid === pid);
      boardEl.classList.toggle(`active-p${pid}`, activePid === pid);
    }
    const selfBand = $("#selfBand");
    const opponentBand = $("#opponentBand");
    const opponentPid = selfPid === 1 ? 2 : 1;
    for (const [band, pid] of [[selfBand, selfPid], [opponentBand, opponentPid]]) {
      band.classList.toggle("p1Band", pid === 1);
      band.classList.toggle("p2Band", pid === 2);
      band.classList.toggle("active-turn", activePid === pid);
    }
    turnText.className = activePid ? `turn p${activePid}t` : "turn";
    handPanel?.classList.toggle("inactive-turn",
      Boolean(state && !state.gameOver && (state.current !== selfPid || state.deploymentCommitted)));
    const readyToEnd = Boolean(state && !state.gameOver && state.current === selfPid
      && state.deploymentCommitted && !turnBlockReason());
    selfBand?.classList.toggle("turn-ready", readyToEnd);
  }

  function onlineReportText() {
    if (!state) return "尚無戰報資料。";
    const artilleryRounds = pid => state.logs
      .filter(item => item.kind === (pid === 1 ? "r" : "b") && item.text.includes("炮擊"))
      .map(item => item.round);
    return `最終輪數：${state.roundNo}\n`
      + `P1 炮擊輪數：${artilleryRounds(1).join("、") || "未使用"}\n`
      + `P2 炮擊輪數：${artilleryRounds(2).join("、") || "未使用"}\n`
      + `剩餘炮擊：P1 ${state.artillery[1]}／P2 ${state.artillery[2]}\n`
      + `${cardLine("P1 卡片", state.cardDistribution?.P1)}\n`
      + `${cardLine("P2 卡片", state.cardDistribution?.P2)}`;
  }

  function renderResultOverlay() {
    const overlay = $("#resultOverlay");
    if (!state?.gameOver || pendingCombat || combatPlayback.active()) {
      overlay.classList.add("hidden");
      resultReportOpen = false;
      return;
    }
    const box = overlay.querySelector(".resultBox");
    box.classList.remove("result-p1", "result-p2", "result-neutral");
    box.classList.add(state.winner === 1 ? "result-p1" : state.winner === 2 ? "result-p2" : "result-neutral");
    $("#resultTitle").textContent = UI.resultLabel(state);
    $("#resultReason").textContent = UI.resultReasonLabel(state);

    const rematch = rematchControl();
    const rematchButton = $("#resultRematchBtn");
    rematchButton.disabled = rematch.disabled;
    rematchButton.textContent = rematch.text;
    rematchButton.title = rematch.disabled ? rematch.text : "";

    const leaveButton = $("#resultLeaveBtn");
    leaveButton.disabled = !connected;
    leaveButton.textContent = connected ? "離開房間" : "離開房間｜等待伺服器連線";
    leaveButton.title = connected ? "" : "尚未連上伺服器";

    const report = $("#resultReport");
    const reportButton = $("#resultReportBtn");
    report.textContent = onlineReportText();
    report.classList.toggle("hidden", !resultReportOpen);
    reportButton.setAttribute("aria-expanded", String(resultReportOpen));
    reportButton.textContent = resultReportOpen ? "收起戰報" : "看戰報";
    overlay.classList.remove("hidden");
  }

  function setConnectionBadge(selector) {
    const element = $(selector);
    element.textContent = connected ? "伺服器已連線" : "伺服器未連線";
    element.className = `connection ${connected ? "ok" : "bad"}`;
  }

  function authoritativeNow() {
    return Date.now() - gameClockDelta;
  }

  function updateTurnTimer() {
    const timer = $("#turnTimer");
    if (!timer) return;
    if (!state || state.gameOver) {
      timer.textContent = "—";
      timer.className = "turnTimer";
      timer.title = "";
      return;
    }

    let remaining;
    let total;
    if (!opponentConnected && opponentDisconnectDeadline) {
      remaining = Math.max(0, opponentDisconnectDeadline - authoritativeNow());
      total = state.timeoutRules?.disconnectMs;
      timer.textContent = `離場 ${Math.ceil(remaining / 1000)}s`;
      timer.title = "對手斷線逾時倒數；回合計時目前暫停";
      $("#opponentConnectionText").textContent = `已斷線｜剩 ${Math.ceil(remaining / 1000)} 秒`;
    } else if (state.turnClockPaused) {
      timer.textContent = "暫停";
      timer.title = "回合計時暫停";
      timer.className = "turnTimer";
      return;
    } else {
      remaining = Math.max(0, Number(state.turnDeadline) - authoritativeNow());
      total = state.timeoutRules?.turnMs;
      timer.textContent = `${Math.ceil(remaining / 1000)}s`;
      timer.title = "本回合剩餘時間";
    }
    timer.className = `turnTimer ${total && remaining <= total / 4 ? "urgent" : ""}`.trim();
  }

  function relativeAge(createdAt) {
    const serverNow = Date.now() - lobbyClockDelta;
    const elapsed = Math.max(0, serverNow - Number(createdAt || serverNow));
    if (elapsed < 60_000) return "剛剛建立";
    if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分鐘前`;
    if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小時前`;
    return `${Math.floor(elapsed / (24 * 60 * 60_000))} 天前`;
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }

  function closePasswordPrompt() {
    $("#passwordOverlay").classList.add("hidden");
    $("#joinPasswordInput").value = "";
    $("#passwordError").textContent = "";
    pendingJoinCode = null;
    pendingJoinName = "";
  }

  function openPasswordPrompt(code, name, error = "") {
    if (!code) return;
    const switchedRoom = pendingJoinCode !== code;
    pendingJoinCode = code;
    pendingJoinName = name;
    $("#passwordRoomName").textContent = `${name}｜房號 ${code}`;
    $("#passwordError").textContent = error;
    if (switchedRoom) $("#joinPasswordInput").value = "";
    $("#passwordOverlay").classList.remove("hidden");
    setTimeout(() => {
      $("#joinPasswordInput").focus();
      if (error) $("#joinPasswordInput").select();
    }, 0);
  }

  function joinRoom(code, password = "", roomName = "") {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) {
      notice = "請輸入房號。";
      render();
      return;
    }
    if (!connected) return;
    try { localStorage.removeItem(sessionKey()); }
    catch { /* 無儲存權限時沒有舊工作階段可移除 */ }
    pendingJoinCode = normalized;
    pendingJoinName = roomName || `房號 ${normalized}`;
    notice = "正在加入房間…";
    send({ type: "join_room", roomCode: normalized, password, nickname: nickname() });
    render();
  }

  function renderLobbyRooms() {
    const roomList = $("#roomList");
    roomList.replaceChildren();
    $("#roomCount").textContent = `${lobbyRooms.length} 間`;
    $("#emptyRooms").classList.toggle("hidden", lobbyRooms.length > 0);
    roomList.classList.toggle("hidden", lobbyRooms.length === 0);
    for (const room of lobbyRooms) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "roomCard";
      card.setAttribute("aria-label", `加入 ${room.name}，建立者 ${room.createdBy}${room.hasPassword ? "，需要密碼" : ""}`);
      card.append(
        textElement("span", "roomCardName", room.name),
        textElement("span", "roomLock", room.hasPassword ? "🔒" : ""),
        textElement("span", "roomCreator", `建立者：${room.createdBy}`),
        textElement("span", "roomAge", relativeAge(room.createdAt)),
        textElement("span", "roomStatus", "● 等待加入"),
        textElement("span", "roomJoinHint", room.hasPassword ? "輸入密碼" : "直接加入"),
      );
      card.onclick = () => room.hasPassword
        ? openPasswordPrompt(room.code, room.name)
        : joinRoom(room.code, "", room.name);
      roomList.appendChild(card);
    }
  }

  function renderWaitingRoom() {
    const modeLabel = requestedMode === "alternating" ? "｜交替先手（開發測試）" : "";
    const creator = roomInfo?.players?.[1];
    const opponent = roomInfo?.players?.[2];
    $("#seatedRoomName").textContent = roomInfo?.name || "正在取得房間資料…";
    $("#roomIdentity").textContent = `房號 ${roomCode || "—"}｜你是 P${selfPid || "—"}${modeLabel}`
      + (notice ? `\n${notice}` : "");
    $("#seatedCreatorName").textContent = creator?.nickname || roomInfo?.createdBy || "玩家";
    $("#seatedOpponentName").textContent = opponent?.nickname || "等待對手";
    $("#seatedOpponentStatus").textContent = opponent?.connected ? "已加入，正在開始" : "尚未加入";
    $("#seatedOpponentDot").className = `statusDot ${opponent?.connected ? "online" : ""}`.trim();
  }

  function setPlayerAvatar(selector, pid) {
    const avatar = $(selector);
    avatar.textContent = pid ? `P${pid}` : "P?";
    avatar.className = `playerAvatar ${pid === 1 ? "p1Avatar" : pid === 2 ? "p2Avatar" : "neutralAvatar"}`;
  }

  function renderPlayerBands() {
    const opponentPid = selfPid === 1 ? 2 : 1;
    const ownSeat = roomInfo?.players?.[selfPid];
    const opponentSeat = roomInfo?.players?.[opponentPid];
    setPlayerAvatar("#selfAvatar", selfPid);
    setPlayerAvatar("#opponentAvatar", opponentPid);
    $("#selfName").textContent = ownSeat?.nickname || "你";
    $("#selfRole").textContent = `P${selfPid}｜你`;
    $("#opponentName").textContent = opponentSeat?.nickname || "對手";
    $("#opponentRole").textContent = `P${opponentPid}｜對手`;
    $("#selfHandCount").textContent = `手牌 ${state.own.hand.length}`;
    $("#opponentHandCount").textContent = String(state.opponent.handCount);
    $("#selfArtillery").textContent = `炮擊 ${state.artillery[selfPid]}`;
    $("#opponentArtillery").textContent = String(state.artillery[opponentPid]);
    $("#opponentStatusDot").className = `statusDot ${opponentConnected ? "online" : "offline"}`;
    $("#opponentConnectionText").textContent = opponentConnected ? "已連線"
      : roomStatus === "opponent_left" ? "已離開" : "已斷線";
  }

  function render() {
    syncCombatCue();
    design.sync(state, turnBlockReason());
    setConnectionBadge("#socketStatus");
    setConnectionBadge("#gameSocketStatus");
    const inGame = Boolean(state);
    const seated = Boolean(roomCode);
    $("#lobbyScreen").classList.toggle("hidden", inGame);
    $("#gameScreen").classList.toggle("hidden", !inGame);
    const lobbyLayout = document.querySelector(".lobbyLayout");
    lobbyLayout.classList.toggle("seated", seated);
    $("#roomDirectory").classList.toggle("hidden", seated);
    $("#unseatedPanel").classList.toggle("hidden", seated);
    $("#seatedRoomPanel").classList.toggle("hidden", !seated);
    $("#lobbyNotice").textContent = notice;
    renderLobbyRooms();

    const createButton = $("#createBtn");
    const joinButton = $("#joinBtn");
    const createLabel = requestedMode === "alternating" ? "建立交替先手房間（非正式規則）" : "建立房間";
    createButton.disabled = !connected || seated;
    createButton.textContent = connected ? createLabel : `${createLabel}｜等待連線`;
    createButton.title = connected ? "" : "尚未連上伺服器";
    joinButton.disabled = !connected || seated;
    joinButton.textContent = connected ? "加入房間" : "加入房間｜等待連線";
    joinButton.title = connected ? "" : "尚未連上伺服器";
    if (seated && !inGame) renderWaitingRoom();
    if (!state) {
      design.update({ view: null });
      $("#resultOverlay").classList.add("hidden");
      updateTurnTimer();
      return;
    }

    $("#gameRoomName").textContent = roomInfo?.name || "連線對戰";
    $("#gameRoomCode").textContent = roomCode ? `房號 ${roomCode}` : "";
    renderPlayerBands();
    const leaveRoomButton = $("#leaveRoomBtn");
    leaveRoomButton.disabled = !connected;
    leaveRoomButton.textContent = connected
      ? state.gameOver ? "離開房間" : "棄賽並離開"
      : "離開房間｜等待連線";
    leaveRoomButton.title = connected
      ? state.gameOver ? "" : "離開後本局會中止，對手會看到你已離開"
      : "尚未連上伺服器";
    if (!combatPlayback.active()) renderBoard();
    renderHand();
    renderLogs();
    renderForecast();
    renderTurnVisual();
    const phase = state.gameOver ? { text: "", full: "", level: "none" } : AlphaUI.matchPhaseLabel(state);
    // 警示走獨立的固定格；turnText 是 nowrap+ellipsis，塞進去會被截掉。
    const badge = $("#phaseBadge");
    if (badge) { badge.textContent = phase.text;
    badge.className = `phaseBadge ${phase.level === "none" ? "" : phase.level}`.trim();
    badge.title = phase.full || phase.text; }
    const perspective = state.current === selfPid ? "輪到你" : "輪到對手";
    $("#turnText").textContent = state.gameOver ? "對局結束"
      : perspective;
    $("#turnText").title = `P${state.firstPlayer} 先行${state.turnOrderMode === "fixed" ? "｜本局固定順序" : ""}`;
    const blocked = turnBlockReason();
    const actionText = state.gameOver ? UI.resultLabel(state)
      : blocked ? `操作暫停：${blocked}。`
      : artilleryMode ? "炮擊模式：點選中心預覽範圍，再按確認。"
      : state.deploymentCommitted ? "主要行動已完成：仍可炮擊，然後按「結束回合」。"
      : moveMode() ? (moveFrom ? "點選標示的合法空格預覽，再按確認移動。" : "手牌用盡：選擇自己的棋子移動。")
      : state.canAct === false ? "目前無法部署或移動，請按「結束回合」。"
      : selectedType ? `已選 ${"★".repeat(selectedRank)}${NAMES[selectedType]}，點空格預覽，再按確認部署。`
      : "先選手牌，再選棋格；確認後才會部署。";
    $("#turnStatus").textContent = notice ? `${actionText}\n${notice}` : actionText;
    const artilleryButton = $("#artilleryBtn");
    const artilleryBase = `炮擊（P${selfPid} 剩 ${state.artillery[selfPid]} 發）`;
    const disabledReason = artilleryReason();
    artilleryButton.textContent = disabledReason ? `${artilleryBase}｜${disabledReason}` : artilleryBase;
    artilleryButton.disabled = Boolean(disabledReason);
    artilleryButton.title = disabledReason;
    artilleryButton.className = `btn art artBtn ${artilleryMode ? "active" : "ready"}`;
    const endTurnButton = $("#endTurnBtn");
    const endDisabledReason = endTurnReason();
    endTurnButton.textContent = endDisabledReason
      ? `結束回合｜${endDisabledReason}`
      : "結束回合";
    endTurnButton.disabled = Boolean(endDisabledReason);
    endTurnButton.title = endDisabledReason;
    endTurnButton.className = `btn endTurnBtn ${endDisabledReason ? "" : "ready"}`.trim();
    updateTurnTimer();
    renderResultOverlay();
    design.update({ view: state, blocked: turnBlockReason(), selectedType, selectedRank,
      artilleryMode, moveFrom, confirm: confirmAction, cancel: cancelSelection });
    startPendingCombat();
  }

  // ---- 規則視窗：文案與開關都由共用的 AlphaUI 提供 ----
  UI.wireRulesOverlay(catalog);
  UI.wireBattleLogDrawer();

  $("#nicknameInput").value = loadNickname();
  $("#nicknameInput").addEventListener("change", nickname);
  $("#createBtn").onclick = () => {
    if (!connected) return;
    try { localStorage.removeItem(sessionKey()); }
    catch { /* 無儲存權限時沒有舊工作階段可移除 */ }
    notice = "正在建立房間…";
    send({
      type: "create_room",
      mode: requestedMode,
      nickname: nickname(),
      name: $("#roomNameInput").value,
      password: $("#roomPasswordInput").value,
    });
    render();
  };
  $("#copyRoomBtn").onclick = async () => {
    if (!roomCode) return;
    try { await navigator.clipboard.writeText(roomCode); notice = `已複製房號 ${roomCode}`; }
    catch { notice = `複製失敗，請手動記下房號 ${roomCode}`; }
    render();
  };
  $("#joinBtn").onclick = () => {
    const code = $("#roomInput").value.trim().toUpperCase();
    if (code.length !== 6) {
      notice = "請輸入完整的 6 碼房號。";
      render();
      return;
    }
    joinRoom(code, $("#directPasswordInput").value);
  };
  $("#roomInput").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase(); });
  $("#roomInput").addEventListener("keydown", event => { if (event.key === "Enter") $("#joinBtn").click(); });
  const submitPassword = () => {
    if (!pendingJoinCode) return;
    const password = $("#joinPasswordInput").value;
    if (!password) {
      $("#passwordError").textContent = "請輸入房間密碼。";
      return;
    }
    const code = pendingJoinCode;
    const name = pendingJoinName;
    $("#passwordError").textContent = "正在驗證…";
    joinRoom(code, password, name);
  };
  $("#confirmPasswordBtn").onclick = submitPassword;
  $("#cancelPasswordBtn").onclick = closePasswordPrompt;
  $("#joinPasswordInput").addEventListener("keydown", event => { if (event.key === "Enter") submitPassword(); });
  $("#passwordOverlay").addEventListener("click", event => {
    if (event.target === $("#passwordOverlay")) closePasswordPrompt();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePasswordPrompt();
  });
  $("#artilleryBtn").onclick = () => {
    if (artilleryReason()) return;
    design.clearDraft(); design.clearInspect();
    artilleryMode = !artilleryMode; hoverCell = null;
    selectedType = null; hoverType = null; moveFrom = null; notice = ""; render();
  };
  $("#endTurnBtn").onclick = () => {
    if (!endTurnReason()) {
      artilleryMode = false;
      sendIntent({ kind: "end_turn" });
    }
  };
  const requestRematch = () => { if (!rematchControl().disabled) send({ type: "rematch" }); };
  const leaveRoom = () => { if (connected && roomCode) send({ type: "leave_room" }); };
  $("#leaveWaitingBtn").onclick = leaveRoom;
  $("#leaveRoomBtn").onclick = leaveRoom;
  $("#resultRematchBtn").onclick = requestRematch;
  $("#resultLeaveBtn").onclick = leaveRoom;
  $("#resultReportBtn").onclick = () => {
    resultReportOpen = !resultReportOpen;
    renderResultOverlay();
  };

  setInterval(() => {
    if (!roomCode && !state) renderLobbyRooms();
  }, 30_000);
  setInterval(updateTurnTimer, 250);
  render();
  connect();
})();
