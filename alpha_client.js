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
  if (requestedMode === "alternating") {
    document.title = "五連戰線｜交替先手（開發測試）";
    $("h1").textContent = "五連戰線｜交替先手（開發測試）";
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
  let state = null;
  let selectedType = null;
  let selectedRank = 1;
  let artilleryMode = false;
  let pendingRequest = false;
  let notice = "";
  let hoverType = null;                       // 滑鼠正在預覽的兵種
  let resultReportOpen = false;

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

  function send(message) {
    if (!connected) return;
    socket.send(JSON.stringify(message));
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener("open", () => {
      connected = true;
      notice = "";
      const saved = loadSession();
      if (saved?.roomCode && saved?.token) send({ type: "reconnect", roomCode: saved.roomCode, token: saved.token });
      render();
    });
    socket.addEventListener("close", () => {
      connected = false;
      notice = "與伺服器斷線，正在嘗試重新連線…";
      render();
      setTimeout(connect, 1800);
    });
    socket.addEventListener("error", () => { notice = "WebSocket 連線錯誤"; render(); });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.type === "session") {
        saveSession(message);
        roomCode = message.roomCode;
        selfPid = message.pid;
      } else if (message.type === "state") {
        const previousTurnId = state?.turnId;
        roomCode = message.roomCode;
        selfPid = message.selfPid;
        opponentConnected = message.opponentConnected;
        roomStatus = message.status;
        state = message.state;
        rematchState = message.rematch || { self: false, opponent: false };
        pendingRequest = false;
        if (!state?.gameOver) resultReportOpen = false;
        if (!state || state.current !== selfPid || state.turnId !== previousTurnId) {
          selectedType = null; selectedRank = 1; artilleryMode = false; moveFrom = null;
        }
      } else if (message.type === "rejected" || message.type === "error") {
        pendingRequest = false;
        notice = message.error;
      } else if (message.type === "accepted") {
        notice = "";
      } else if (message.type === "left") {
        // 主動離開：把本機的房間狀態清乾淨，才不會拿舊房的 state 去比對新的 selfPid
        roomCode = null; selfPid = null; state = null; roomStatus = null;
        opponentConnected = false; rematchState = { self: false, opponent: false };
        pendingRequest = false; artilleryMode = false; selectedType = null;
        resultReportOpen = false;
        localStorage.removeItem(sessionKey());
        notice = "已離開房間。";
        $("#entryOverlay").classList.remove("hidden");
      } else if (message.type === "match_log_saved") {
        notice = `終局戰報已儲存：${message.filename}`;
      }
      render();
    });
  }

  // 手牌用盡且場上還有棋子可以走時，本回合改為移動。
  // 連線端沒有引擎實例，從 state.board 自行推導（規則參數仍取自 state.movementRules）。
  function moveMode() {
    if (!state || state.gameOver || state.own.hand.length > 0) return false;
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
      deploymentCommitted: state?.deploymentCommitted,
    });
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
    send({ type: "action", requestId, intent: { ...intent, turnId: state.turnId } });
    render();
  }

  function onCell(r, c) {
    if (!ownTurn()) return;
    if (artilleryMode) {
      artilleryMode = false;
      sendIntent({ kind: "artillery", r, c });
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
    const blocked = turnBlockReason();
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
      if (!selectedType || !ownTurn() || !stats) return;
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
    turnText.className = activePid ? `turn p${activePid}t` : "turn";
    handPanel?.classList.toggle("inactive-turn",
      Boolean(state && !state.gameOver && state.current !== selfPid));
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
    if (!state?.gameOver) {
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

  function render() {
    $("#socketStatus").textContent = connected ? "伺服器已連線" : "伺服器未連線";
    $("#socketStatus").className = `connection ${connected ? "ok" : "bad"}`;
    // 入座後就不再顯示建立／加入：先前可以在對局中跳到別的房，
    // 結果是對手被永久留在「對手已斷線」，自己也可能佔到自己那間房的另一個座位。
    const seated = Boolean(roomCode);
    for (const id of ["#createBtn", "#joinBtn", "#roomInput"]) {
      $(id).classList.toggle("hidden", seated);
    }
    const createButton = $("#createBtn");
    const joinButton = $("#joinBtn");
    const createLabel = requestedMode === "alternating" ? "建立交替先手房間（非正式規則）" : "建立房間";
    createButton.disabled = !connected;
    createButton.textContent = connected ? createLabel : `${createLabel}｜等待連線`;
    createButton.title = connected ? "" : "尚未連上伺服器";
    joinButton.disabled = !connected;
    joinButton.textContent = connected ? "加入房間" : "加入房間｜等待連線";
    joinButton.title = connected ? "" : "尚未連上伺服器";
    $("#leaveRoomBtn").classList.toggle("hidden", !seated);
    const over = Boolean(state?.gameOver);
    const rematchBtn = $("#rematchBtn");
    rematchBtn.classList.toggle("hidden", !over);
    const rematch = rematchControl();
    rematchBtn.disabled = rematch.disabled;
    rematchBtn.textContent = rematch.text;
    rematchBtn.title = rematch.disabled ? rematch.text : "";
    const leaveRoomButton = $("#leaveRoomBtn");
    leaveRoomButton.disabled = !connected;
    leaveRoomButton.textContent = connected ? "離開房間" : "離開房間｜等待連線";
    leaveRoomButton.title = connected ? "" : "尚未連上伺服器";
    const modeLabel = (state?.turnOrderMode || requestedMode) === "alternating" ? "｜交替先手（開發測試）" : "";
    $("#roomIdentity").textContent = roomCode ? `房號 ${roomCode}｜你是 P${selfPid}${modeLabel}` : "";
    $("#copyRoomBtn").classList.toggle("hidden", !roomCode);
    // 重連成功後直接進遊戲，不要再擋一層入口畫面
    if (roomCode) $("#entryOverlay").classList.add("hidden");

    const statusTexts = {
      none: "尚未建立或加入房間。",
      waiting: "房間已建立，正在等待 P2 加入。",
      ready: "兩名玩家已連線，準備開始。",
      playing: "雙方連線正常。",
      opponent_disconnected: "對手已斷線；房間會暫時保留，等待原玩家重連。",
      opponent_left: "對手已離開房間，本局無法繼續。請按「離開房間」再開新局。",
      finished: "本局已結束。雙方都按「再來一局」即可用同一間房再開一場。",
    };
    $("#connectionDetail").textContent = `${statusTexts[roomStatus] || statusTexts.none}${notice ? `\n${notice}` : ""}`;
    $("#connectionDetail").className = `combatPreview ${roomStatus === "opponent_disconnected" || !connected ? "bad" : roomStatus === "waiting" ? "wait" : ""}`;
    renderBoard();
    renderHand();
    renderLogs();
    renderForecast();
    renderTurnVisual();

    const privacyInfo = $("#privacyInfo");
    const summarySection = $("#matchSummarySection");
    if (!state) {
      $("#turnText").textContent = roomCode ? "等待對手" : "";
      $("#turnStatus").textContent = notice
        ? `兩人連線後由伺服器建立正式遊戲狀態。\n${notice}`
        : "兩人連線後由伺服器建立正式遊戲狀態。";
      const badge = $("#phaseBadge");
      badge.textContent = "";
      badge.className = "phaseBadge";
      privacyInfo.classList.add("hidden");
      summarySection.classList.add("hidden");
      renderResultOverlay();
      return;
    }
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
      : state.current === selfPid && moveMode()
        ? (moveFrom ? `已選 (${moveFrom[0] + 1},${moveFrom[1] + 1})，點相鄰空格移動`
            : "手牌已用盡：本回合改為移動，點自己的一顆棋再點相鄰空格")
      : state.current === selfPid
        ? state.artilleryUsedThisTurn ? "輪到你：炮擊已使用，必須完成部署" : "輪到你：可先炮擊，然後部署"
      : "等待對方完成操作";
    $("#turnStatus").textContent = notice ? `${actionText}\n${notice}` : actionText;
    $("#artilleryOverview").textContent = `公開炮擊資源｜P1：${state.artillery[1]} 發｜P2：${state.artillery[2]} 發`;
    const p1Cards = state.cardDistribution.P1;
    const p2Cards = state.cardDistribution.P2;
    privacyInfo.textContent = `自己的手牌：${state.own.hand.length} 張｜對方手牌：${state.opponent.handCount} 張（內容隱藏）\n${cardLine("P1", p1Cards)}\n${cardLine("P2", p2Cards)}`;
    privacyInfo.classList.remove("hidden");
    const artilleryButton = $("#artilleryBtn");
    const artilleryBase = `炮擊（P${selfPid} 剩 ${state.artillery[selfPid]} 發）`;
    const disabledReason = artilleryReason();
    artilleryButton.textContent = disabledReason ? `${artilleryBase}｜${disabledReason}` : artilleryBase;
    artilleryButton.disabled = Boolean(disabledReason);
    artilleryButton.title = disabledReason;
    artilleryButton.className = `btn art artBtn ${artilleryMode ? "active" : "ready"}`;

    if (state.gameOver) {
      summarySection.classList.remove("hidden");
      const ownRounds = state.logs.filter(item => item.kind === (selfPid === 1 ? "r" : "b") && item.text.includes("炮擊")).map(item => item.round);
      summarySection.querySelector("#matchSummary").textContent = `勝負：${UI.resultLabel(state)}\n最終輪數：${state.roundNo}\n你的炮擊輪數：${ownRounds.join("、") || "未使用"}\n剩餘炮擊：P1 ${state.artillery[1]}／P2 ${state.artillery[2]}\n${cardLine("P1 卡片", p1Cards)}\n${cardLine("P2 卡片", p2Cards)}`;
    } else summarySection.classList.add("hidden");
    renderResultOverlay();
  }

  // ---- 入口：單機 / 連線兩個模式。只是 UI 層，server routing 不動 ----
  const entryOverlay = $("#entryOverlay");
  const showEntry = () => entryOverlay.classList.remove("hidden");
  const hideEntry = () => entryOverlay.classList.add("hidden");
  $("#entryOnlineBtn").onclick = hideEntry;
  $("#backToEntryBtn").onclick = showEntry;      // 只切換畫面，不動房間或對局狀態

  // ---- 規則視窗：文案與開關都由共用的 AlphaUI 提供 ----
  UI.wireRulesOverlay(catalog);

  $("#createBtn").onclick = () => { localStorage.removeItem(sessionKey()); send({ type: "create_room", mode: requestedMode }); };
  $("#copyRoomBtn").onclick = async () => {
    if (!roomCode) return;
    try { await navigator.clipboard.writeText(roomCode); notice = `已複製房號 ${roomCode}`; }
    catch { notice = `複製失敗，請手動記下房號 ${roomCode}`; }
    render();
  };
  $("#joinBtn").onclick = () => {
    localStorage.removeItem(sessionKey());
    send({ type: "join_room", roomCode: $("#roomInput").value.trim().toUpperCase() });
  };
  $("#roomInput").addEventListener("keydown", event => { if (event.key === "Enter") $("#joinBtn").click(); });
  $("#artilleryBtn").onclick = () => { if (ownTurn()) { artilleryMode = !artilleryMode; selectedType = null; render(); } };
  const requestRematch = () => { if (!rematchControl().disabled) send({ type: "rematch" }); };
  const leaveRoom = () => { if (connected && roomCode) send({ type: "leave_room" }); };
  $("#rematchBtn").onclick = requestRematch;
  $("#leaveRoomBtn").onclick = leaveRoom;
  $("#resultRematchBtn").onclick = requestRematch;
  $("#resultLeaveBtn").onclick = leaveRoom;
  $("#resultReportBtn").onclick = () => {
    resultReportOpen = !resultReportOpen;
    renderResultOverlay();
  };

  render();
  connect();
})();
