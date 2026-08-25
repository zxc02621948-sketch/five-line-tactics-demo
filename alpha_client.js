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
  let opponentConnected = false;
  let roomStatus = "none";
  let state = null;
  let selectedType = null;
  let selectedRank = 1;
  let artilleryMode = false;
  let pendingRequest = false;
  let notice = "";
  let hoverType = null;                       // 滑鼠正在預覽的兵種

  // 兵種數值一律取自 server 送來的 unitCatalog；尚未進房時退回同一份 game_engine.js
  // 的靜態目錄，兩者是同一個來源，不會漂移。
  const catalog = () => (state && state.unitCatalog)
    || globalThis.FiveLineEngine?.GameEngine.unitCatalog()
    || null;

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
        if (!state || state.current !== selfPid || state.turnId !== previousTurnId) {
          selectedType = null; selectedRank = 1; artilleryMode = false;
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
        localStorage.removeItem(sessionKey());
        notice = "已離開房間。";
        $("#entryOverlay").classList.remove("hidden");
      } else if (message.type === "match_log_saved") {
        notice = `終局戰報已儲存：${message.filename}`;
      }
      render();
    });
  }

  function ownTurn() {
    return Boolean(connected && state && !pendingRequest && !state.gameOver && opponentConnected && state.current === selfPid);
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
      sendIntent({ kind: "artillery", r, c });
      artilleryMode = false;
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
    state.own.hand.forEach(type => {
      const button = document.createElement("button");
      button.className = `card ${selectedType === type ? "sel" : ""}`;
      button.disabled = !ownTurn();
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
        button.className = `btn ${selectedRank === rank ? "active" : ""}`;
        button.textContent = capped
          ? `★★（場上已有${NAMES[selectedType]}）`
          : `${"★".repeat(rank)}（${cost}張）`;
        button.disabled = !ownTurn() || counts[selectedType] < cost || capped;
        button.title = capped ? "同兵種★★同時只能有一隻，等它陣亡後才能再合成" : "";
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

  function render() {
    $("#socketStatus").textContent = connected ? "伺服器已連線" : "伺服器未連線";
    $("#socketStatus").className = `connection ${connected ? "ok" : "bad"}`;
    // 入座後就不再顯示建立／加入：先前可以在對局中跳到別的房，
    // 結果是對手被永久留在「對手已斷線」，自己也可能佔到自己那間房的另一個座位。
    const seated = Boolean(roomCode);
    for (const id of ["#createBtn", "#joinBtn", "#roomInput"]) {
      $(id).classList.toggle("hidden", seated);
    }
    $("#createBtn").disabled = !connected;
    $("#joinBtn").disabled = !connected;
    $("#leaveRoomBtn").classList.toggle("hidden", !seated);
    const over = Boolean(state?.gameOver);
    const rematchBtn = $("#rematchBtn");
    rematchBtn.classList.toggle("hidden", !over);
    rematchBtn.disabled = !connected || rematchState.self || !opponentConnected;
    rematchBtn.textContent = rematchState.self ? "已請求，等待對手…"
      : rematchState.opponent ? "對手想再來一局 ▸ 接受" : "再來一局";
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

    const privacyInfo = $("#privacyInfo");
    const summarySection = $("#matchSummarySection");
    if (!state) {
      $("#turnText").textContent = roomCode ? "等待對手" : "";
      $("#turnStatus").textContent = "兩人連線後由伺服器建立正式遊戲狀態。";
      privacyInfo.classList.add("hidden");
      summarySection.classList.add("hidden");
      return;
    }
    const phase = state.gameOver ? { text: "", full: "", level: "none" } : AlphaUI.matchPhaseLabel(state);
    // 警示走獨立的固定格；turnText 是 nowrap+ellipsis，塞進去會被截掉。
    const badge = $("#phaseBadge");
    if (badge) { badge.textContent = phase.text;
    badge.className = `phaseBadge ${phase.level === "none" ? "" : phase.level}`.trim();
    badge.title = phase.full || phase.text; }
    $("#turnText").textContent = `第 ${state.roundNo} 輪｜P${state.firstPlayer} 先行｜現在 P${state.current}${state.turnOrderMode === "fixed" ? "｜本局固定順序" : ""}`;
    $("#turnStatus").textContent = state.gameOver
      ? UI.resultLabel(state)
      : !opponentConnected ? "對手已斷線，等待重連"
      : state.current === selfPid
        ? state.artilleryUsedThisTurn ? "輪到你：炮擊已使用，必須完成部署" : "輪到你：可先炮擊，然後部署"
        : "等待對方完成操作";
    $("#artilleryOverview").textContent = `公開炮擊資源｜P1：${state.artillery[1]} 發｜P2：${state.artillery[2]} 發`;
    const p1Cards = state.cardDistribution.P1;
    const p2Cards = state.cardDistribution.P2;
    const cardLine = (label, cards) => `${label} 牌庫 ${cards.deck}／手牌 ${cards.hand}／冷卻 ${cards.cooldown}／場上綁定 ${cards.boardBoundCards}／總數 ${cards.total}${cards.valid ? "" : " ⚠"}`;
    privacyInfo.textContent = `自己的手牌：${state.own.hand.length} 張｜對方手牌：${state.opponent.handCount} 張（內容隱藏）\n${cardLine("P1", p1Cards)}\n${cardLine("P2", p2Cards)}`;
    privacyInfo.classList.remove("hidden");
    const artilleryButton = $("#artilleryBtn");
    artilleryButton.textContent = `炮擊（P${selfPid} 剩 ${state.artillery[selfPid]} 發）`;
    artilleryButton.disabled = !ownTurn() || state.artillery[selfPid] <= 0 || state.artilleryUsedThisTurn || state.deploymentCommitted;
    artilleryButton.className = `btn art ${artilleryMode ? "active" : ""}`;

    if (state.gameOver) {
      summarySection.classList.remove("hidden");
      const ownRounds = state.logs.filter(item => item.kind === (selfPid === 1 ? "r" : "b") && item.text.includes("炮擊")).map(item => item.round);
      summarySection.querySelector("#matchSummary").textContent = `勝負：${UI.resultLabel(state)}\n最終輪數：${state.roundNo}\n你的炮擊輪數：${ownRounds.join("、") || "未使用"}\n剩餘炮擊：P1 ${state.artillery[1]}／P2 ${state.artillery[2]}\n${cardLine("P1 卡片", p1Cards)}\n${cardLine("P2 卡片", p2Cards)}`;
    } else summarySection.classList.add("hidden");
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
  $("#rematchBtn").onclick = () => send({ type: "rematch" });
  $("#leaveRoomBtn").onclick = () => send({ type: "leave_room" });

  render();
  connect();
})();
