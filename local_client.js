// /local 單機測試。規則完全來自正式的 game_engine.js，這裡只做操作與顯示。
// 兩種模式維持原本用途：對電腦（P2 由簡單啟發式代打）與本機雙人（同一台電腦輪流操作）。
(() => {
  const FiveLine = globalThis.FiveLineEngine;
  const { GameEngine, ALPHA_TURN_ORDER } = FiveLine;
  const UI = globalThis.AlphaUI;
  const { NAMES } = UI;
  const $ = selector => document.querySelector(selector);
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const LINES = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

  let engine = null;
  let mode = "pve";
  let selectedType = null;
  let selectedRank = 1;
  let hoverType = null;
  let artilleryMode = false;
  let notice = "";
  let aiThinking = false;
  let resigned = null;                 // 棄賽者的 pid；棄賽只影響本機顯示，不動引擎規則

  const catalog = () => GameEngine.unitCatalog();
  const finished = () => Boolean(resigned) || (engine && engine.gameOver);
  // 對局已開始 ＝ 盤面上有棋子。開始後就不該還能自由切換模式。
  const started = () => Boolean(engine) && engine.board.some(row => row.some(Boolean));
  const humanTurn = () => engine && !finished() && !aiThinking
    && (mode === "pvp" || engine.current === 1);

  function reset() {
    // 對電腦與本機雙人都使用正式回合順序：固定 P1 → P2 → combat
    engine = new GameEngine({ roomCode: "LOCAL1", ...ALPHA_TURN_ORDER });
    selectedType = null; selectedRank = 1; hoverType = null;
    artilleryMode = false; notice = ""; aiThinking = false; resigned = null;
    render();
    scheduleAi();
  }

  // ---- 顯示 ----
  // 每次重繪都依當下容器重算棋盤尺寸，不倚賴 ResizeObserver 的觸發時機
  const sizeBoard = UI.autoSizeBoard(document.querySelector("#board"), document.querySelector(".boardWrap"));

  function renderBoard() {
    sizeBoard();
    const boardEl = $("#board");
    boardEl.innerHTML = "";
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const unit = engine.board[r][c];
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
    const handEl = $("#hand");
    handEl.innerHTML = "";
    $("#rankRow").innerHTML = "";
    const pid = engine.current;
    const player = engine.players[pid - 1];
    const cat = catalog();
    const counts = { sword: 0, shield: 0, spear: 0 };
    player.hand.forEach(type => counts[type]++);

    player.hand.forEach(type => {
      const button = document.createElement("button");
      button.className = `card ${selectedType === type ? "sel" : ""}`;
      button.disabled = !humanTurn();
      button.innerHTML = UI.handCardHtml(type, cat);
      button.onclick = () => { selectedType = type; selectedRank = 1; artilleryMode = false; render(); };
      button.addEventListener("mouseenter", () => { hoverType = type; renderCardDetail(); });
      button.addEventListener("mouseleave", () => { hoverType = null; renderCardDetail(); });
      button.addEventListener("focus", () => { hoverType = type; renderCardDetail(); });
      button.addEventListener("blur", () => { hoverType = null; renderCardDetail(); });
      handEl.appendChild(button);
    });

    const owner = mode === "pve" && pid === 2 ? "電腦" : `P${pid}`;
    $("#handTitle").textContent = `${owner} 的手牌（${player.hand.length}/5）`;
    $("#deckInfo").textContent = `牌庫 ${player.deck.length}｜冷卻 `
      + (player.cooldown.map(item => `${NAMES[item.type]}:${item.turns}`).join("、") || "無");

    if (selectedType) {
      // ★★★ 已停用；★★ 每兵種同時只能有一隻在場（由引擎強制）。
      const eliteOut = engine.board.flat()
        .some(unit => unit && unit.pid === pid && unit.rank === 2 && unit.type === selectedType);
      for (const [rank, cost] of [[1, 1], [2, 3]]) {
        const button = document.createElement("button");
        const capped = rank === 2 && eliteOut;
        button.className = `btn ${selectedRank === rank ? "active" : ""}`;
        button.textContent = capped ? `★★（場上已有${NAMES[selectedType]}）` : `${"★".repeat(rank)}（${cost}張）`;
        button.disabled = !humanTurn() || counts[selectedType] < cost || capped;
        button.title = capped ? "同兵種★★同時只能有一隻，等它陣亡後才能再合成" : "";
        button.onclick = () => { selectedRank = rank; render(); };
        $("#rankRow").appendChild(button);
      }
      if (selectedRank === 2 && eliteOut) selectedRank = 1;
    }
    renderCardDetail();
  }


  // ---- 攻擊指示：滑鼠移到格子上就用正式引擎預演一次 ----
  // 已有棋子的格 → 它打誰、誰打它；空格 → 若把手上選的兵種放下去會發生什麼。
  // 觸控沒有 hover：點「已有棋子」的格子同樣會顯示（那格本來也不能部署，不衝突）。
  let hoverCell = null;
  let artilleryPlan = null;              // 目前瞄準格的炮擊預測，供狀態列顯示

  function renderForecast() {
    const layer = $("#forecastLayer");
    const boardEl = $("#board");
    if (!layer || !boardEl || !engine) return;
    layer.innerHTML = "";
    if (!hoverCell) {                        // 移開瞄準格時要把統計一起清掉
      if (artilleryPlan) { artilleryPlan = null; updateStatusText(); }
      return;
    }
    const [r, c] = hoverCell;
    if (artilleryMode) {                     // 炮擊模式：改畫 3×3 範圍與每格傷害
      const plan = UI.forecastArtillery(engine.board, r, c,
        GameEngine.artilleryRules(), engine.current);
      UI.drawArtillery(layer, boardEl, plan);
      artilleryPlan = plan;
      updateStatusText();
      return;
    }
    if (artilleryPlan) { artilleryPlan = null; updateStatusText(); }
    let ghost = null;
    if (!engine.board[r][c]) {
      if (!selectedType || !humanTurn()) return;
      const stats = FiveLine.baseStats(selectedType, selectedRank);
      if (!stats) return;
      ghost = { r, c, unit: { id: -1, pid: engine.current, type: selectedType, rank: selectedRank,
        cards: selectedRank === 2 ? 3 : 1, hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk } };
    }
    const view = UI.forecast(engine.board, ghost);
    const focus = UI.focusOn(view, r, c);
    if (!view || !focus) return;
    if (!focus.outgoing.length && !focus.incoming.length) return;
    UI.drawForecast(layer, boardEl, view, focus);
  }

  function renderCardDetail() {
    // 觸控裝置沒有 hover，點選是它唯一能叫出大卡的方式，所以保留
    // selectedType 當後備；但在有 hover 的裝置上不能這樣，否則選完牌
    // 大卡會一直蓋在棋盤上擋住落子——點完牌滑鼠還在該張牌上所以仍看得到，
    // 一往棋盤移動 mouseleave 就會把它收起來。
    const noHover = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
    UI.renderCardDetail($("#cardDetail"), hoverType || (noHover ? selectedType : null), catalog());
  }

  function renderLogs() {
    const logEl = $("#log");
    logEl.innerHTML = "";
    for (const item of engine.logs) {
      const div = document.createElement("div");
      div.className = item.kind;
      div.textContent = `R${item.round}｜${item.text}`;
      logEl.prepend(div);
    }
  }

  function render() {
    if (!engine) return;
    renderBoard();
    renderHand();
    renderLogs();
    renderForecast();
    const owner = mode === "pve" && engine.current === 2 ? "P2（電腦）" : `P${engine.current}`;
    const winnerLabel = resigned
      ? `P${resigned} 棄賽｜P${3 - resigned} 獲勝`
      : engine.winner === "double_loss" ? "消極對局：雙方棄賽"
      : engine.winner === "draw" ? "雙方同時五連：平手" : `P${engine.winner} 獲勝`;
    const otRules = GameEngine.overtimeRules();
    const phase = finished() ? { text: "", full: "", level: "none" } : AlphaUI.matchPhaseLabel({
      overtime: engine.overtime,
      overtimeRound: engine.overtime ? engine.roundNo - engine.overtimeStartRound : 0,
      overtimeRules: otRules,
      quietRounds: engine.quietRounds,
      passivityForfeitRounds: otRules.passivityForfeitRounds,
    });
    // 警示走獨立的固定格；turnText 是 nowrap+ellipsis，塞進去會被截掉。
    const badge = $("#phaseBadge");
    if (badge) { badge.textContent = phase.text;
    badge.className = `phaseBadge ${phase.level === "none" ? "" : phase.level}`.trim();
    badge.title = phase.full || phase.text; }
    $("#turnText").textContent = finished()
      ? winnerLabel
      : `第 ${engine.roundNo} 輪｜${owner} 行動｜${engine.actionsThisRound === 0 ? "先手" : "後手"}`;
    updateStatusText();
    $("#artilleryOverview").textContent =
      `炮擊資源｜P1：${engine.players[0].artillery} 發｜P2：${engine.players[1].artillery} 發`;
    const artilleryBtn = $("#artilleryBtn");
    const me = engine.players[engine.current - 1];
    artilleryBtn.textContent = `炮擊（本回合方剩 ${me.artillery} 發）`;
    artilleryBtn.disabled = !humanTurn() || me.artillery <= 0
      || engine.artilleryUsedThisTurn || engine.deploymentCommitted;
    artilleryBtn.className = `btn artBtn ${artilleryMode ? "active" : "ready"}`;
    renderSessionControls();
  }

  // 狀態文字獨立出來：炮擊瞄準時 renderForecast 會算出命中統計，需要單獨刷新。
  function updateStatusText() {
    const text = finished()
      ? "按「重開」開始新的一局，或切換對戰模式。"
      : artilleryMode ? (artilleryPlan
          ? `炮擊瞄準中：命中敵軍 ${artilleryPlan.enemies}、友軍 ${artilleryPlan.allies}`
            + `｜預計擊殺 ${artilleryPlan.kills}、誤殺友軍 ${artilleryPlan.losses}`
          : "炮擊模式：移到棋盤上可預覽 3×3 範圍與傷害。")
        : selectedType ? `已選 ${"★".repeat(selectedRank)}${NAMES[selectedType]}，點空格部署。`
          : "先點手牌選擇兵種，再點棋盤空格部署。";
    $("#status").textContent = notice ? `${text}
${notice}` : text;
  }

  // 對局進行中不顯示模式切換與重開，避免誤觸中斷戰鬥；改提供棄賽。
  // 尚未落子或對局結束時才恢復，讓玩家可以自由換模式。
  function renderSessionControls() {
    const inGame = started() && !finished();
    for (const id of ["#pveBtn", "#pvpBtn", "#resetBtn"]) {
      $(id).classList.toggle("hidden", inGame);
    }
    const resign = $("#resignBtn");
    resign.classList.toggle("hidden", !inGame);
    resign.textContent = mode === "pve" ? "棄賽" : "結束對局";
    resign.disabled = !inGame;
  }

  // ---- 操作 ----
  function act(intent) {
    const result = intent.kind === "artillery"
      ? engine.artillery(engine.current, { ...intent, turnId: engine.turnId })
      : engine.deploy(engine.current, { ...intent, turnId: engine.turnId });
    notice = result.ok ? "" : result.error;
    if (result.ok) { selectedType = null; selectedRank = 1; hoverType = null; }
    render();
    if (result.ok) scheduleAi();
    return result;
  }

  function onCell(r, c) {
    if (!humanTurn()) return;
    if (artilleryMode) { artilleryMode = false; act({ kind: "artillery", r, c }); return; }
    if (!selectedType) { notice = "請先選擇手牌"; render(); return; }
    act({ kind: "deploy", r, c, type: selectedType, rank: selectedRank });
  }

  // ---- 對電腦模式的簡單啟發式（只使用引擎的公開介面）----
  function scheduleAi() {
    if (mode !== "pve" || finished() || engine.current !== 2) return;
    aiThinking = true;
    render();
    setTimeout(() => { aiThinking = false; aiMove(); }, 320);
  }

  function lineScore(r, c, pid) {
    let score = -(Math.abs(r - 4) + Math.abs(c - 4)) * 0.05;
    for (const [dr, dc] of LINES) for (let off = -4; off <= 0; off++) {
      let own = 0, enemy = 0, ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * (off + k), cc = c + dc * (off + k);
        if (!inB(rr, cc)) { ok = false; break; }
        const unit = engine.board[rr][cc];
        if (unit && unit.pid === pid) own++; else if (unit) enemy++;
      }
      if (!ok || (own && enemy)) continue;
      if (!enemy) score += own * own * 1.15 + (own === 4 ? 500 : 0);
      if (!own) score += 0.95 * (enemy * enemy + (enemy === 4 ? 520 : 0));
    }
    for (const [dr, dc] of ORTHO) {
      const unit = inB(r + dr, c + dc) && engine.board[r + dr][c + dc];
      if (unit) score += unit.pid === pid ? 0.25 : 0.4;
    }
    return score;
  }

  function aiMove() {
    if (finished() || engine.current !== 2) { render(); return; }
    const player = engine.players[1];
    if (!player.hand.length) { render(); return; }

    let best = null, bestScore = -Infinity;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (engine.board[r][c]) continue;
      const score = lineScore(r, c, 2);
      if (score > bestScore) { bestScore = score; best = [r, c]; }
    }
    if (!best) { render(); return; }

    const counts = { sword: 0, shield: 0, spear: 0 };
    player.hand.forEach(type => counts[type]++);
    const [r, c] = best;
    // 選兵種：優先剋制落點附近的敵人
    let type = player.hand[0], typeScore = -Infinity;
    for (const candidate of Object.keys(counts).filter(item => counts[item])) {
      let score = counts[candidate] * 0.05;
      for (const [dr, dc] of ORTHO) for (let d = 1; d <= 2; d++) {
        const unit = inB(r + dr * d, c + dc * d) && engine.board[r + dr * d][c + dc * d];
        if (!unit) continue;
        if (unit.pid !== 2 && catalog()[candidate].counters === unit.type) score += 2;
        break;
      }
      if (score > typeScore) { typeScore = score; type = candidate; }
    }
    const eliteOut = engine.board.flat()
      .some(unit => unit && unit.pid === 2 && unit.rank === 2 && unit.type === type);
    const rank = counts[type] >= 3 && !eliteOut && Math.random() < 0.5 ? 2 : 1;

    const result = engine.deploy(2, { r, c, type, rank, turnId: engine.turnId });
    if (!result.ok) engine.deploy(2, { r, c, type, rank: 1, turnId: engine.turnId });
    render();
  }

  // ---- 綁定 ----
  UI.wireRulesOverlay(catalog);
  $("#artilleryBtn").onclick = () => { if (humanTurn()) { artilleryMode = !artilleryMode; artilleryPlan = null; render(); } };
  $("#resetBtn").onclick = reset;
  $("#resignBtn").onclick = () => {
    if (!started() || finished()) return;
    // 只在本機顯示層結束對局，不修改 game_engine.js 的規則
    resigned = mode === "pve" ? 1 : engine.current;
    artilleryMode = false; selectedType = null; hoverType = null;
    notice = mode === "pve" ? "你已棄賽。" : `P${resigned} 結束了本局。`;
    render();
  };
  $("#pveBtn").onclick = () => {
    mode = "pve";
    $("#pveBtn").classList.add("active"); $("#pvpBtn").classList.remove("active");
    reset();
  };
  $("#pvpBtn").onclick = () => {
    mode = "pvp";
    $("#pvpBtn").classList.add("active"); $("#pveBtn").classList.remove("active");
    reset();
  };
  const fullscreenBtn = $("#fullscreenBtn");
  if (fullscreenBtn) fullscreenBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  $("#pveBtn").classList.add("active");
  reset();
})();
