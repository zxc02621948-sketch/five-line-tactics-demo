(() => {
  const ICONS = { sword: "⚔", shield: "🛡", spear: "🔱" };
  const NAMES = { sword: "劍", shield: "盾", spear: "槍" };
  const $ = selector => document.querySelector(selector);
  const boardEl = $("#board");
  const handEl = $("#hand");
  const logEl = $("#log");
  const requestedMode = location.pathname.endsWith("alpha-fixed.html") ? "fixed" : "alternating";
  if (requestedMode === "fixed") {
    document.title = "五連戰線｜固定順序實驗";
    $("h1").textContent = "五連戰線｜固定順序實驗";
    $("#createBtn").textContent = "建立固定順序房間";
  }
  let socket;
  let connected = false;
  let roomCode = null;
  let selfPid = null;
  let opponentConnected = false;
  let roomStatus = "none";
  let state = null;
  let selectedType = null;
  let selectedRank = 1;
  let artilleryMode = false;
  let pendingRequest = false;
  let notice = "";
  let hoverType = null;                       // 滑鼠正在預覽的兵種

  // 兵種數值一律取自 server 的 unitCatalog，前端不另外抄一份，避免與引擎漂移。
  const SHORT_TAG = { sword: "決鬥", shield: "護衛", spear: "遠射" };
  const ELITE_TAG = { sword: "斬入", shield: "反震", spear: "穿透" };
  const ABILITY = {
    sword: { tag: "決鬥", lines: ["只有單一攻擊目標時，該次攻擊具有額外攻擊優勢。"] },
    shield: { tag: "護衛", lines: ["正交相鄰的非盾友軍受到傷害時，其中 50% 改由盾承受。"] },
    spear: { tag: "遠射", lines: [
      "沿正交方向攻擊，射程最多 2 格。",
      "攻擊力依「有敵人的攻擊方向數」平均分配；同方向有多個敵人不會再被稀釋。",
    ] },
  };
  const ELITE_ABILITY = {
    sword: { tag: "斬入", lines: [
      "親自擊殺自己的攻擊目標後，強制移入該敵人的死亡格。",
      "接著攻擊新位置正交相鄰中 HP 最低的敵人一次。",
      "這次追加攻擊不會再次觸發斬入。",
    ] },
    shield: { tag: "反震", lines: [
      "不主動攻擊。",
      "保留 50% 護衛。",
      "自己實際被扣掉多少 HP，就對傷害來源造成等量的反震傷害。",
    ] },
    spear: { tag: "穿透", lines: [
      "可以穿過第一格的單位攻擊第二格，射程仍然只有 2 格。",
      "第一格是敵人：受到該方向 100% 傷害；第二格的敵人受到 50%。",
      "第一格是友軍：友軍不受傷，第二格的敵人仍受到 50%。",
    ] },
  };
  const catalog = () => (state && state.unitCatalog) || null;

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
        pendingRequest = false;
        if (!state || state.current !== selfPid || state.turnId !== previousTurnId) {
          selectedType = null; selectedRank = 1; artilleryMode = false;
        }
      } else if (message.type === "rejected" || message.type === "error") {
        pendingRequest = false;
        notice = message.error;
      } else if (message.type === "accepted") {
        notice = "";
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

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const unit = state?.board?.[r]?.[c];
      if (unit) {
        const div = document.createElement("div");
        div.className = `unit p${unit.pid}`;
        div.innerHTML = `<span class="stars">${"★".repeat(unit.rank)}</span><span class="unitIcon">${ICONS[unit.type]}</span><small>${Math.max(0, Math.round(unit.hp))}/${unit.maxHp}</small><span class="hpbar"><i style="width:${Math.max(0, Math.min(100, unit.hp / unit.maxHp * 100))}%"></i></span>`;
        div.title = `P${unit.pid} ${NAMES[unit.type]} ${"★".repeat(unit.rank)}｜HP ${Math.round(unit.hp)}/${unit.maxHp}｜攻 ${unit.atk}`;
        cell.appendChild(div);
      }
      cell.addEventListener("click", () => onCell(r, c));
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
    const statLine = type => {
      if (!cat) return "";
      const one = cat[type].ranks[1], two = cat[type].ranks[2];
      const twoAtk = two.attacks ? two.atk : "—";
      return `<span class="cardStats">★ HP${one.maxHp}／攻${one.atk}<br>★★ HP${two.maxHp}／攻${twoAtk}</span>`;
    };
    state.own.hand.forEach(type => {
      const button = document.createElement("button");
      button.className = `card ${selectedType === type ? "sel" : ""}`;
      button.disabled = !ownTurn();
      button.innerHTML = `<span class="ico">${ICONS[type]}</span><span class="name">${NAMES[type]}</span>`
        + statLine(type)
        + `<span class="cardTag">${SHORT_TAG[type]}／★★${ELITE_TAG[type]}</span>`;
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

  // 卡牌詳情固定在手牌下方，不浮動、不會蓋住棋盤操作區。
  function renderCardDetail() {
    const box = $("#cardDetail");
    if (!box) return;
    const type = hoverType || selectedType;
    const cat = catalog();
    if (!type || !cat) {
      box.innerHTML = "滑鼠移到手牌上（或點選手牌）可看該兵種的詳細能力。";
      return;
    }
    const info = cat[type];
    const one = info.ranks[1], two = info.ranks[2];
    const twoAtk = two.attacks ? String(two.atk) : "—（不主動攻擊）";
    const list = lines => `<ul>${lines.map(item => `<li>${item}</li>`).join("")}</ul>`;
    box.innerHTML = `<div class="detailHead">${ICONS[type]} ${info.name}</div>`
      + `<div class="detailMeta">★　HP ${one.maxHp}／攻 ${one.atk}　｜　★★　HP ${two.maxHp}／攻 ${twoAtk}<br>`
      + `克制：${NAMES[info.counters]}　｜　被克制：${NAMES[info.counteredBy]}　｜　★★ 需要 3 張同兵種卡</div>`
      + `<div class="detailAbility"><b>${ABILITY[type].tag}</b>${list(ABILITY[type].lines)}</div>`
      + `<div class="detailAbility"><b>★★ ${ELITE_ABILITY[type].tag}</b>${list(ELITE_ABILITY[type].lines)}</div>`;
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
    $("#createBtn").disabled = !connected;
    $("#joinBtn").disabled = !connected;
    const modeLabel = state?.turnOrderMode === "fixed" || requestedMode === "fixed" ? "｜固定順序實驗" : "";
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
      finished: "本局已結束。",
    };
    $("#connectionDetail").textContent = `${statusTexts[roomStatus] || statusTexts.none}${notice ? `\n${notice}` : ""}`;
    $("#connectionDetail").className = `status ${roomStatus === "opponent_disconnected" || !connected ? "bad" : roomStatus === "waiting" ? "wait" : ""}`;
    renderBoard();
    renderHand();
    renderLogs();

    if (!state) {
      $("#turnText").textContent = roomCode ? "等待對手" : "";
      $("#turnStatus").textContent = "兩人連線後由伺服器建立正式遊戲狀態。";
      $("#privacyInfo").textContent = "自己的手牌會顯示在左側；對手只能看到手牌數量。";
      return;
    }
    $("#turnText").textContent = `第 ${state.roundNo} 輪｜P${state.firstPlayer} 先行｜現在 P${state.current}${state.turnOrderMode === "fixed" ? "｜本局固定順序" : ""}`;
    $("#turnStatus").textContent = state.gameOver
      ? state.winner === "draw" ? "雙方同時五連：平手" : `P${state.winner} 獲勝`
      : !opponentConnected ? "對手已斷線，等待重連"
      : state.current === selfPid
        ? state.artilleryUsedThisTurn ? "輪到你：炮擊已使用，必須完成部署" : "輪到你：可先炮擊，然後部署"
        : "等待對方完成操作";
    $("#artilleryOverview").textContent = `公開炮擊資源｜P1：${state.artillery[1]} 發｜P2：${state.artillery[2]} 發`;
    const p1Cards = state.cardDistribution.P1;
    const p2Cards = state.cardDistribution.P2;
    const cardLine = (label, cards) => `${label} 牌庫 ${cards.deck}／手牌 ${cards.hand}／冷卻 ${cards.cooldown}／場上綁定 ${cards.boardBoundCards}／總數 ${cards.total}${cards.valid ? "" : " ⚠"}`;
    $("#privacyInfo").textContent = `自己的手牌：${state.own.hand.length} 張｜對方手牌：${state.opponent.handCount} 張（內容隱藏）\n${cardLine("P1", p1Cards)}\n${cardLine("P2", p2Cards)}`;
    const artilleryButton = $("#artilleryBtn");
    artilleryButton.textContent = `炮擊（P${selfPid} 剩 ${state.artillery[selfPid]} 發）`;
    artilleryButton.disabled = !ownTurn() || state.artillery[selfPid] <= 0 || state.artilleryUsedThisTurn || state.deploymentCommitted;
    artilleryButton.className = `btn art ${artilleryMode ? "active" : ""}`;

    const summarySection = $("#matchSummarySection");
    if (state.gameOver) {
      summarySection.classList.remove("hidden");
      const ownRounds = state.logs.filter(item => item.kind === (selfPid === 1 ? "r" : "b") && item.text.includes("炮擊")).map(item => item.round);
      summarySection.querySelector("#matchSummary").textContent = `勝負：${state.winner === "draw" ? "平手" : `P${state.winner}`}\n最終輪數：${state.roundNo}\n你的炮擊輪數：${ownRounds.join("、") || "未使用"}\n剩餘炮擊：P1 ${state.artillery[1]}／P2 ${state.artillery[2]}\n${cardLine("P1 卡片", p1Cards)}\n${cardLine("P2 卡片", p2Cards)}`;
    } else summarySection.classList.add("hidden");
  }

  // ---- 入口：單機 / 連線兩個模式。只是 UI 層，server routing 不動 ----
  const entryOverlay = $("#entryOverlay");
  const showEntry = () => entryOverlay.classList.remove("hidden");
  const hideEntry = () => entryOverlay.classList.add("hidden");
  $("#entryOnlineBtn").onclick = hideEntry;
  $("#backToEntryBtn").onclick = showEntry;      // 只切換畫面，不動房間或對局狀態

  // ---- 規則視窗：純顯示，開關不影響房間與對局 ----
  const rulesOverlay = $("#rulesOverlay");
  function openRules() {
    $("#rulesBody").innerHTML = rulesHtml();
    rulesOverlay.classList.remove("hidden");
  }
  const closeRules = () => rulesOverlay.classList.add("hidden");
  $("#helpBtn").onclick = openRules;
  $("#entryHelpBtn").onclick = openRules;
  $("#rulesCloseBtn").onclick = closeRules;
  rulesOverlay.addEventListener("click", event => { if (event.target === rulesOverlay) closeRules(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeRules(); });

  function rulesHtml() {
    const cat = catalog();
    const row = type => {
      if (!cat) return "";
      const info = cat[type], one = info.ranks[1], two = info.ranks[2];
      const twoAtk = two.attacks ? two.atk : "—";
      return `<tr><td>${ICONS[type]} ${info.name}</td><td>${one.maxHp}／${one.atk}</td>`
        + `<td>${two.maxHp}／${twoAtk}</td><td>${NAMES[info.counters]}</td><td>${NAMES[info.counteredBy]}</td></tr>`;
    };
    const statsTable = cat ? `<table><tr><th>兵種</th><th>★ HP／攻</th><th>★★ HP／攻</th><th>克制</th><th>被克制</th></tr>`
      + ["sword", "shield", "spear"].map(row).join("") + `</table>` : "<p>（加入房間後會顯示實際數值）</p>";
    const block = (type, elite) => {
      const src = elite ? ELITE_ABILITY[type] : ABILITY[type];
      return `<b>${elite ? "★★ " : ""}${NAMES[type]}　${src.tag}</b>`
        + `<ul>${src.lines.map(item => `<li>${item}</li>`).join("")}</ul>`;
    };
    return `
      <h3>勝利條件</h3>
      <div class="flow">雙方完成本回合行動　→　全場戰鬥結算　→　檢查存活五連</div>
      <ul>
        <li>橫、直、斜任一方向連成 5 顆<b>並且戰鬥後仍然存活</b>，才算獲勝。</li>
        <li>放下第五顆<b>不會</b>立刻獲勝；要撐過該回合的戰鬥結算。</li>
        <li>雙方同時達成五連時為平手。</li>
      </ul>

      <h3>回合流程</h3>
      <ul>
        <li>每回合雙方各部署 1 顆棋。</li>
        <li>兩人都行動完後，伺服器一次結算全場戰鬥。</li>
        <li>所有合法性與傷害都由伺服器決定，畫面只負責顯示。</li>
      </ul>

      <h3>兵種相剋</h3>
      <div class="flow">🛡 盾　→　⚔ 劍　→　🔱 槍　→　🛡 盾</div>
      <ul><li>盾克劍、劍克槍、槍克盾。箭頭方向就是「克制」的方向。</li></ul>
      ${statsTable}

      <h3>★ 兵種能力</h3>
      ${block("sword")}${block("shield")}${block("spear")}

      <h3>★★ 菁英能力</h3>
      ${block("sword", true)}${block("shield", true)}${block("spear", true)}

      <h3>★★ 的限制</h3>
      <ul>
        <li>★★ 需要 <b>3 張同兵種卡</b>合成。</li>
        <li>每位玩家、每個兵種<b>同時最多只能有 1 隻 ★★</b>在場（劍／盾／槍分開計算）。</li>
        <li>該 ★★ 陣亡後就解除限制，之後可以再合成同兵種的 ★★。</li>
        <li>手上牌夠但場上已有同兵種 ★★ 時，仍然可以正常部署 ★。</li>
      </ul>

      <h3>卡片循環</h3>
      <ul>
        <li>單位陣亡後，它綁定的卡會進入 <b>3 回合冷卻</b>，之後回到牌庫重新循環。</li>
        <li>★★ 陣亡時，3 張卡會一起進冷卻。</li>
      </ul>

      <h3>炮擊</h3>
      <ul>
        <li>每人整場 <b>2 發</b>。</li>
        <li>只能在自己<b>部署之前</b>使用，每回合最多 1 發；用完仍然必須完成部署。</li>
        <li>以指定格為中心的 3×3 範圍：<b>中心 30 點</b>、外圈 8 格<b>各 12 點</b>。</li>
        <li><b>會誤傷自己的單位</b>，範圍內不分敵我。</li>
      </ul>`;
  }

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

  render();
  connect();
})();
