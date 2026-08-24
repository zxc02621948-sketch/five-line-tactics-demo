// /local 單機測試。規則完全來自正式的 game_engine.js，這裡只做操作與顯示。
// 兩種模式維持原本用途：對電腦（P2 由簡單啟發式代打）與本機雙人（同一台電腦輪流操作）。
(() => {
  const { GameEngine, ALPHA_TURN_ORDER } = globalThis.FiveLineEngine;
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

  const catalog = () => GameEngine.unitCatalog();
  const humanTurn = () => engine && !engine.gameOver && !aiThinking
    && (mode === "pvp" || engine.current === 1);

  function reset() {
    // 對電腦與本機雙人都使用正式回合順序：固定 P1 → P2 → combat
    engine = new GameEngine({ roomCode: "LOCAL1", ...ALPHA_TURN_ORDER });
    selectedType = null; selectedRank = 1; hoverType = null;
    artilleryMode = false; notice = ""; aiThinking = false;
    render();
    scheduleAi();
  }

  // ---- 顯示 ----
  function renderBoard() {
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

  function renderCardDetail() {
    UI.renderCardDetail($("#cardDetail"), hoverType || selectedType, catalog());
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
    const owner = mode === "pve" && engine.current === 2 ? "P2（電腦）" : `P${engine.current}`;
    $("#turnText").textContent = engine.gameOver
      ? (engine.winner === "draw" ? "雙方同時五連：平手" : `P${engine.winner} 獲勝`)
      : `第 ${engine.roundNo} 輪｜${owner} 行動｜${engine.actionsThisRound === 0 ? "先手" : "後手"}`;
    $("#status").textContent = engine.gameOver
      ? "按「重開」開始新的一局。"
      : artilleryMode ? "炮擊模式：點棋盤選擇 3×3 的中心格。"
        : selectedType ? `已選 ${"★".repeat(selectedRank)}${NAMES[selectedType]}，點空格部署。`
          : "先點手牌選擇兵種，再點棋盤空格部署。";
    if (notice) $("#status").textContent += `\n${notice}`;
    $("#artilleryOverview").textContent =
      `炮擊資源｜P1：${engine.players[0].artillery} 發｜P2：${engine.players[1].artillery} 發`;
    const artilleryBtn = $("#artilleryBtn");
    const me = engine.players[engine.current - 1];
    artilleryBtn.textContent = `炮擊（本回合方剩 ${me.artillery} 發）`;
    artilleryBtn.disabled = !humanTurn() || me.artillery <= 0
      || engine.artilleryUsedThisTurn || engine.deploymentCommitted;
    artilleryBtn.className = `btn artBtn ${artilleryMode ? "active" : "ready"}`;
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
    if (mode !== "pve" || engine.gameOver || engine.current !== 2) return;
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
    if (engine.gameOver || engine.current !== 2) { render(); return; }
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
  $("#artilleryBtn").onclick = () => { if (humanTurn()) { artilleryMode = !artilleryMode; render(); } };
  $("#resetBtn").onclick = reset;
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
