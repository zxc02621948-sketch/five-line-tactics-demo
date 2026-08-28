(() => {
  const UI = globalThis.AlphaUI;
  const { ICONS, NAMES } = UI;
  const $ = selector => document.querySelector(selector);
  const boardEl = $("#board");
  const handEl = $("#hand");
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
    localStorage.setItem(sessionKey(), JSON.stringify({ roomCode: message.roomCode, token: message.token, pid: message.pid }));
  }
  function loadSession() {
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

  function schedulePendingRequestTimeout() {
    cancelPendingRequestTimeout();
    pendingRequestTimer = setTimeout(() => {
      if (!pendingRequest) return;
      pendingRequest = false;
      pendingRequestTimer = null;
      pendingTimedOut = true;
      notice = `伺服器超過 ${REQUEST_TIMEOUT_MS / 1000} 秒沒有回傳新狀態，已解除等待，請重試。`;
      render();
    }, REQUEST_TIMEOUT_MS);
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener("open", () => {
      connected = true;
      notice = "";
      const saved = loadSession();
      if (saved?.roomCode && saved?.token) send({ type: "reconnect", roomCode: saved.roomCode, token: saved.token });
      if (pendingRequest) schedulePendingRequestTimeout();
      render();
    });
    socket.addEventListener("close", () => {
      connected = false;
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
        gameClockDelta = Date.now() - Number(message.serverNow || Date.now());
        opponentDisconnectDeadline = Number(message.opponentDisconnectDeadline) || null;
        roomCode = message.roomCode;
        selfPid = message.selfPid;
        opponentConnected = message.opponentConnected;
        roomStatus = message.status;
        roomInfo = message.room || null;
        state = message.state;
        rematchState = message.rematch || { self: false, opponent: false };
        clearPendingRequest();
        if (pendingTimedOut) notice = "";
        pendingTimedOut = false;
        if (!state?.gameOver) resultReportOpen = false;
        if (!state || state.current !== selfPid || state.turnId !== previousTurnId) {
          selectedType = null; selectedRank = 1; artilleryMode = false; moveFrom = null;
        } else if (state.deploymentCommitted) {
          selectedType = null; selectedRank = 1; moveFrom = null;
        }
      } else if (message.type === "rejected" || message.type === "error") {
        clearPendingRequest();
        pendingTimedOut = false;
        if (message.errorCode === "reconnect_failed") {
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

  // 手牌用盡且場上還有棋子可以走時，本回合改為移動。
  // 連線端沒有引擎實例，從 state.board 自行推導（規則參數仍取自 state.movementRules）。
  function moveMode() {
    if (!state || state.gameOver || state.deploymentCommitted || state.own.hand.length > 0) return false;
    return legalMovesFromState().length > 0;
  }
  function legalMovesFromState() {
    if (!state) return [];
    const moves = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const unit = state.board[r][c];
      if (!unit || unit.pid !== selfPid) continue;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nc >= 0 && nr < 9 && nc < 9 && !state.board[nr][nc]) moves.push([r, c, nr, nc]);
      }
    }
    return moves;
  }

  function turnBlockReason() {
    if (!connected) return "尚未連上伺服器";
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
    pendingRequest = true;
    pendingTimedOut = false;
    send({ type: "action", requestId, intent: { ...intent, turnId: state.turnId } });
    schedulePendingRequestTimeout();
    render();
  }

  function onCell(r, c) {
    if (!ownTurn()) return;
    if (artilleryMode) {
      artilleryMode = false;
      sendIntent({ kind: "artillery", r, c });
      return;
    }
    if (state.deploymentCommitted) {
      notice = "主要行動已完成；現在仍可炮擊，或按「結束回合」。";
      render();
      return;
    }
    if (moveMode()) {
      const unit = state.board[r][c];
      if (unit && unit.pid === selfPid) { moveFrom = [r, c]; notice = ""; render(); return; }
      if (!moveFrom) { notice = "手牌已用盡：請先點自己的一顆棋，再點相鄰空格。"; render(); return; }
      const [fr, fc] = moveFrom;
      moveFrom = null;
      sendIntent({ kind: "move", r: fr, c: fc, toR: r, toC: c });
      return;
    }
    if (!selectedType) { notice = "請先選擇自己的手牌"; render(); return; }
    sendIntent({ kind: "deploy", r, c, type: selectedType, rank: selectedRank });
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
    boardEl.innerHTML = "";
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const finalOwner = state?.gameOver ? UI.finalFiveOwner(state, r, c) : 0;
      if (finalOwner) cell.classList.add(`final-five-p${finalOwner}`);
      const unit = state?.board?.[r]?.[c];
      if (unit) {
        const div = document.createElement("div");
        div.className = `unit p${unit.pid}`;
        div.dataset.unitId = String(unit.id);
        div.innerHTML = UI.unitHtml(unit);
        div.title = UI.unitTitle(unit);
        cell.appendChild(div);
      }
      cell.addEventListener("click", () => onCell(r, c));
      cell.addEventListener("mouseenter", () => { hoverCell = [r, c]; renderForecast(); });
      cell.addEventListener("mouseleave", () => { hoverCell = null; renderForecast(); });
      boardEl.appendChild(cell);
    }
  }

  function renderHand() {
    handEl.innerHTML = "";
    $("#rankRow").innerHTML = "";
    if (!state) {
      $("#handTitle").textContent = "等待房間開始";
      $("#deckInfo").textContent = "";
      return;
    }
    const counts = { sword: 0, shield: 0, spear: 0 };
    state.own.hand.forEach(type => counts[type]++);
    const cat = catalog();
    const blocked = placementBlockReason();
    state.own.hand.forEach(type => {
      const button = document.createElement("button");
      button.className = `card ${selectedType === type ? "sel" : ""}`;
      button.disabled = Boolean(blocked);
      button.title = blocked;
      button.innerHTML = UI.handCardHtml(type, cat);
      // 點擊仍然只是「選牌」，原本的選牌→部署流程完全不變。
      button.onclick = () => { selectedType = type; selectedRank = 1; artilleryMode = false; render(); };
      // PC 用 hover 預覽；touch 沒有 hover，靠上面的點選同步更新同一份詳情。
      button.addEventListener("mouseenter", () => { hoverType = type; renderCardDetail(); });
      button.addEventListener("mouseleave", () => { hoverType = null; renderCardDetail(); });
      button.addEventListener("focus", () => { hoverType = type; renderCardDetail(); });
      button.addEventListener("blur", () => { hoverType = null; renderCardDetail(); });
      handEl.appendChild(button);
    });
    $("#handTitle").textContent = `你是 P${selfPid}｜自己的手牌（${state.own.hand.length}/5）`;
    $("#deckInfo").textContent = `自己的牌庫 ${state.own.deckCount}｜冷卻 ${state.own.cooldown.map(item => `${NAMES[item.type]}:${item.turns}`).join("、") || "無"}`;
    if (selectedType) {
      // ★★★ 已停用；★★ 每兵種同時只能有一隻在場。
      const eliteOut = state.board.flat()
        .some(unit => unit && unit.pid === selfPid && unit.rank === 2 && unit.type === selectedType);
      for (const [rank, cost] of [[1, 1], [2, 3]]) {
        const button = document.createElement("button");
        const capped = rank === 2 && eliteOut;
        const reason = UI.rankDisabledReason({ turnReason: blocked, count: counts[selectedType], cost,
          capped, typeName: NAMES[selectedType] });
        button.className = `btn ${selectedRank === rank ? "active" : ""}`;
        button.textContent = capped
          ? `★★（場上已有${NAMES[selectedType]}）`
          : reason ? `${"★".repeat(rank)}｜${reason}` : `${"★".repeat(rank)}（${cost}張）`;
        button.disabled = Boolean(reason);
        button.title = reason;
        button.onclick = () => { selectedRank = rank; render(); };
        $("#rankRow").appendChild(button);
      }
      if (selectedRank === 2 && eliteOut) selectedRank = 1;   // 被上限擋下時自動退回★，不卡住行動
    }
    renderCardDetail();
  }


  // ---- 攻擊指示：滑鼠移到格子上就用正式引擎預演一次 ----
  // 盤面是公開資訊，前端用同一份 game_engine.js 重跑一次公開運算，不涉及隱藏資訊。
  let hoverCell = null;

  function renderForecast() {
    const layer = $("#forecastLayer");
    if (!layer || !boardEl) return;
    layer.innerHTML = "";
    if (pendingCombat || combatPlayback.active()) return;
    const board = state?.board;
    if (!hoverCell || !board) return;
    const [r, c] = hoverCell;
    if (artilleryMode && state.artilleryRules) {
      UI.drawArtillery(layer, boardEl,
        UI.forecastArtillery(board, r, c, state.artilleryRules, selfPid));
      return;
    }
    let ghost = null;
    if (!board[r][c]) {
      const stats = globalThis.FiveLineEngine?.baseStats(selectedType, selectedRank);
      if (!selectedType || !ownTurn() || state.deploymentCommitted || !stats) return;
      ghost = { r, c, unit: { id: -1, pid: selfPid, type: selectedType, rank: selectedRank,
        cards: selectedRank === 2 ? 3 : 1, hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk } };
    }
    const view = UI.forecast(board, ghost);
    const focus = UI.focusOn(view, r, c);
    if (!view || !focus) return;
    if (!focus.outgoing.length && !focus.incoming.length) return;
    UI.drawForecast(layer, boardEl, view, focus);
  }

  // 卡牌詳情固定在手牌下方，不浮動、不會蓋住棋盤操作區。
  function renderCardDetail() {
    // 觸控裝置沒有 hover，點選是它唯一能叫出大卡的方式，所以保留
    // selectedType 當後備；但在有 hover 的裝置上不能這樣，否則選完牌
    // 大卡會一直蓋在棋盤上擋住落子——點完牌滑鼠還在該張牌上所以仍看得到，
    // 一往棋盤移動 mouseleave 就會把它收起來。
    const noHover = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
    UI.renderCardDetail($("#cardDetail"), hoverType || (noHover ? selectedType : null), catalog());
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
    $("#selfHandCount").textContent = String(state.own.hand.length);
    $("#opponentHandCount").textContent = String(state.opponent.handCount);
    $("#selfArtillery").textContent = String(state.artillery[selfPid]);
    $("#opponentArtillery").textContent = String(state.artillery[opponentPid]);
    $("#opponentStatusDot").className = `statusDot ${opponentConnected ? "online" : "offline"}`;
    $("#opponentConnectionText").textContent = opponentConnected ? "已連線"
      : roomStatus === "opponent_left" ? "已離開" : "已斷線";
  }

  function render() {
    syncCombatCue();
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
      : `${perspective}｜P${state.current}｜第 ${state.roundNo} 輪`;
    $("#turnText").title = `P${state.firstPlayer} 先行${state.turnOrderMode === "fixed" ? "｜本局固定順序" : ""}`;
    const blocked = turnBlockReason();
    const actionText = state.gameOver
      ? UI.resultLabel(state)
      : blocked ? `操作暫停：${blocked}。手牌與炮擊會在可操作時恢復。`
      : state.current === selfPid && state.deploymentCommitted
        ? state.artilleryUsedThisTurn
          ? "主要行動與炮擊已完成：請按「結束回合」。"
          : "主要行動已完成：仍可炮擊，然後按「結束回合」。"
      : state.current === selfPid && moveMode()
        ? (moveFrom ? `已選 (${moveFrom[0] + 1},${moveFrom[1] + 1})，點相鄰空格移動`
            : "手牌已用盡：本回合改為移動，點自己的一顆棋再點相鄰空格")
      : state.current === selfPid && state.canAct === false
        ? "目前已無法部署或移動：請按「結束回合」。"
      : state.current === selfPid
        ? state.artilleryUsedThisTurn ? "輪到你：炮擊已使用，必須完成部署" : "輪到你：可先炮擊，然後部署"
      : "等待對方完成操作";
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
  $("#artilleryBtn").onclick = () => { if (ownTurn()) { artilleryMode = !artilleryMode; selectedType = null; render(); } };
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
