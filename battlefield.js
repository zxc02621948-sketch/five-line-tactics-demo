// 共用畫面骨架及送出前的預覽；不結算遊戲規則。
(() => {
  const UI = globalThis.AlphaUI;
  const $ = id => document.getElementById(id);
  const coord = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`;
  const ART = Object.freeze({
    sword: "/assets/units/sword-v1.png", shield: "/assets/units/shield-v1.png",
    spear: "/assets/units/spear-v1.png", elite_sword: "/assets/units/elite-sword-v1.png",
  });
  const SHAPES = Object.freeze({
    sword: '<path d="M22 1 27 0 28 6 14 23 10 19Z" fill="currentColor"/><path d="m5 19 11 10M8 24 2 31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    shield: '<path d="M4 4 16 0 28 4 27 20Q24 27 16 32 8 27 5 20Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 6V25M9 13H23" stroke="currentColor" stroke-width="3"/>',
    spear: '<path d="M27 0 29 11 22 10Z" fill="currentColor"/><path d="M24 10 4 31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="m22 12-7-1 3 8" fill="currentColor" opacity=".5"/>',
  });
  const icon = type => `<svg class="weaponIcon" viewBox="0 0 32 32" aria-hidden="true">${SHAPES[type] || ""}</svg>`;
  const portrait = (type, rank) => ART[type === "sword" && rank === 2 ? "elite_sword" : type] || "";
  function setButton(button, label, reason = "") {
    const strong = document.createElement("strong"); strong.textContent = label;
    const small = document.createElement("span"); small.className = "buttonReason"; small.textContent = reason;
    button.replaceChildren(strong, small);
  }

  function mount({ online }) {
    const host = $("battlefield");
    host.innerHTML = `
      <header class="battleTop top ${online ? "gameTop" : ""}">
        <div class="battleBrand">${icon("sword")}<h1>五連戰線</h1><span>${online ? "連線對戰" : "單機對局"}</span></div>
        <div class="battleTools">
          <button id="helpBtn" class="btn" type="button">規則</button>
          <button id="soundBtn" class="btn" type="button" aria-pressed="false">音效：關</button>
          <details id="matchMenu" class="matchMenu">
            <summary class="btn matchMenuSummary">對局選單</summary>
            <div class="matchMenuPanel">
              <button id="logDrawerToggle" class="btn" type="button" aria-controls="logDrawer" aria-expanded="false">戰鬥紀錄</button>
              ${online ? '<button id="leaveRoomBtn" class="btn danger" type="button">棄賽並離開</button>'
                : '<button id="pveBtn" class="btn" type="button">對電腦</button><button id="pvpBtn" class="btn" type="button">本機雙人</button><button id="resetBtn" class="btn" type="button">重開</button><button id="fullscreenBtn" class="btn" type="button">全螢幕</button><button id="resignBtn" class="btn danger hidden" type="button">棄賽</button><a class="btn modeLink" href="/">連線大廳</a>'}
              ${online ? '<span id="gameRoomName" class="menuInfo"></span><span id="gameRoomCode" class="menuInfo"></span><span id="gameSocketStatus" class="connection"></span>' : ""}
            </div>
          </details>
        </div>
      </header>
      <div class="battleLayout">
        <aside class="battleSidebar">
          <h2 id="roundText">準備對局</h2><span id="roundKind" class="roundKind">一般對局</span>
          <h3>回合進程</h3><ol class="battleFlow"><li id="flowFirst"></li><li id="flowSecond"></li><li id="flowCombat">全場交戰</li></ol>
          <div class="battleGoal"><strong>五連需撐過交戰</strong><p>雙方行動後，才會結算勝負。</p></div>
          <h3>兵種相剋</h3><div id="counterLegend" class="counterLegend"></div>
          <p class="sidebarHint">點選棋子可看詳細數值。<br>Esc 取消尚未送出的選擇。</p>
        </aside>
        <main class="battleCenter">
          <div id="opponentBand" class="playerBand opponentBand">
            <span id="opponentAvatar" class="playerAvatar">P?</span>
            <div class="bandIdentity"><strong id="opponentName">對手</strong><span id="opponentRole">對手</span></div>
            <div class="bandStat"><span>手牌</span><strong id="opponentHandCount">—</strong></div>
            <div class="bandStat"><span>炮擊</span><strong id="opponentArtillery">—</strong></div>
            <div class="bandConnection"><span id="opponentStatusDot" class="statusDot"></span><span id="opponentConnectionText"></span></div>
          </div>
          <div class="battlePhase"><span id="compactRound"></span><span id="phaseBadge" class="phaseBadge"></span></div>
          <div class="boardWrap">
            <div class="boardCoordinates columns" aria-hidden="true">ABCDEFGHI</div>
            <div class="boardCoordinates rows" aria-hidden="true">123456789</div>
            <div id="board" class="board" role="group" aria-label="棋盤；方向鍵移動焦點，Enter 選取"></div>
            <svg id="forecastLayer" class="forecastLayer" aria-hidden="true"></svg>
            <div id="combatStage" class="combatStage hidden"><svg id="combatLayer" class="combatLayer" aria-hidden="true"></svg><div id="combatPieces" class="combatPieces" aria-hidden="true"></div><div class="combatPlaybackHud"><span id="combatStepLabel" class="combatStepLabel" aria-live="polite"></span><button id="skipCombatBtn" class="btn skipCombatBtn" type="button">跳過演出</button></div></div>
          </div>
          <div id="selfBand" class="playerBand selfBand turnSection">
            <span id="selfAvatar" class="playerAvatar">P?</span>
            <div class="bandIdentity"><strong id="selfName">你</strong><span id="selfRole">玩家</span></div>
            <div class="bandTurn"><div id="turnText" class="turn" aria-live="polite"></div><span id="turnTimer" class="turnTimer">—</span></div>
            <div class="selfResources"><span id="selfHandCount"></span><span id="selfArtillery"></span></div>
            <div class="turnActions"><button id="artilleryBtn" class="btn artBtn" type="button" disabled>炮擊</button><button id="endTurnBtn" class="btn endTurnBtn" type="button" disabled>結束回合</button></div>
          </div>
          <div class="battleNotice"><div id="turnStatus" class="status actionStatus" aria-live="polite"></div></div>
          <div class="handPanel"><div class="handHeader"><strong id="handTitle">手牌</strong><span id="deckInfo" class="meta"></span></div><div id="hand" class="hand"></div></div>
        </main>
        <aside class="detailRail">
          <div class="rankControls"><div id="rankRow" class="rankRow"></div><button id="unitDetailBtn" class="btn" type="button">兵種詳情</button></div>
          <div id="cardDetail" class="cardDetail" tabindex="0" aria-label="兵種詳情"></div>
          <div class="confirmationPanel"><div id="selectionStatus" class="selectionStatus" aria-live="polite"></div><div class="confirmActions"><button id="cancelActionBtn" class="btn" type="button" disabled>取消</button><button id="confirmActionBtn" class="btn confirmPrimary" type="button" disabled>請選擇手牌</button></div></div>
        </aside>
      </div>
      <div id="logDrawer" class="logDrawer hidden" aria-hidden="true"><aside class="logDrawerPanel logSection" role="dialog" aria-modal="true" aria-labelledby="logDrawerTitle"><div class="logDrawerHead"><h2 id="logDrawerTitle">戰鬥紀錄</h2><button id="logDrawerClose" class="btn" type="button">關閉</button></div><div id="log" class="log" aria-live="polite"></div></aside></div>
      <dialog id="unitDialog"><div class="rulesHead"><h2>兵種詳情</h2><button id="unitDialogClose" class="btn" type="button">關閉</button></div><div id="unitDialogBody"></div></dialog>`;
    let draft = null, inspectedId = null, currentView = null;
    let callbacks = {}, boardCallbacks = {};
    let sound = false, audio;
    try { sound = localStorage.getItem("five-line-ui-sound") === "on"; } catch {}
    const paintSound = () => {
      $("soundBtn").textContent = `音效：${sound ? "開" : "關"}`;
      $("soundBtn").setAttribute("aria-pressed", String(sound));
    };
    const tone = () => {
      if (!sound) return;
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      try {
        audio ||= new Audio(); void audio.resume().catch(() => {});
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = "sine"; oscillator.frequency.value = 480;
        gain.gain.setValueAtTime(.035, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .07);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(); oscillator.stop(audio.currentTime + .08);
      } catch { /* 沒有音效能力時仍正常操作。 */ }
    };
    $("soundBtn").onclick = () => {
      sound = !sound; paintSound();
      try { localStorage.setItem("five-line-ui-sound", sound ? "on" : "off"); } catch {}
      tone();
    };
    paintSound();
    const dialog = $("unitDialog");
    $("unitDetailBtn").onclick = () => {
      $("unitDialogBody").innerHTML = $("cardDetail").innerHTML;
      if (!dialog.open) dialog.showModal();
      $("unitDialogClose").focus();
    };
    $("unitDialogClose").onclick = () => dialog.close();
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => $("unitDetailBtn").focus());
    $("confirmActionBtn").onclick = () => { if (draft) { tone(); callbacks.confirm?.({ ...draft.intent }); } };
    $("cancelActionBtn").onclick = () => callbacks.cancel?.();
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || dialog.open || document.querySelector(".overlay:not(.hidden), .logDrawer:not(.hidden)") || $("matchMenu").open) return;
      if (event.target.closest?.("input,textarea,select,[contenteditable=true]")) return;
      callbacks.cancel?.();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Tab" || dialog.open) return;
      const visible = [...document.querySelectorAll(".overlay:not(.hidden), .logDrawer:not(.hidden)")].pop();
      if (!visible) return;
      const controls = [...visible.querySelectorAll("button:not(:disabled),input:not(:disabled),a[href]")].filter(el => el.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (!visible.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    });
    for (const coordinates of host.querySelectorAll(".boardCoordinates")) {
      const values = coordinates.textContent;
      coordinates.replaceChildren(...[...values].map(value => {
        const span = document.createElement("span"); span.textContent = value; return span;
      }));
    }
    const cells = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cell = document.createElement("button");
      cell.type = "button"; cell.className = "cell"; cell.tabIndex = cells.length ? -1 : 0;
      cell.onclick = () => boardCallbacks.onCell?.(r, c);
      cell.onmouseenter = () => boardCallbacks.onHover?.([r, c]);
      cell.onmouseleave = () => boardCallbacks.onHover?.(null);
      cell.onfocus = () => {
        for (const item of cells) item.tabIndex = item === cell ? 0 : -1;
        boardCallbacks.onHover?.([r, c]);
      };
      cell.onblur = () => boardCallbacks.onHover?.(null);
      cell.onkeydown = event => {
        const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
        if (!delta) return;
        event.preventDefault();
        const rr = Math.max(0, Math.min(8, r + delta[0])), cc = Math.max(0, Math.min(8, c + delta[1]));
        cells[rr * 9 + cc].focus();
      };
      cells.push(cell); $("board").appendChild(cell);
    }
    function clearDraft() { draft = null; }
    function sync(view, blocked) {
      currentView = view;
      if (!view || view.gameOver || blocked || draft?.matchId !== view.matchId || draft?.turnId !== view.turnId) clearDraft();
      if (inspectedId && !view?.board.flat().some(unit => unit?.id === inspectedId)) inspectedId = null;
      if (view?.gameOver && dialog.open) dialog.close();
    }
    function setDraft(intent, view) { draft = { intent: { ...intent }, turnId: view.turnId, matchId: view.matchId }; }
    function renderBoard(view, options) {
      boardCallbacks = options;
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const cell = cells[r * 9 + c], unit = view.board[r][c], signature = JSON.stringify(unit);
        if (cell.dataset.signature !== signature) {
          cell.replaceChildren();
          if (unit) {
            const piece = document.createElement("span");
            piece.className = `unit p${unit.pid}`; piece.dataset.unitId = String(unit.id);
            piece.innerHTML = UI.unitHtml(unit); cell.appendChild(piece);
          }
          cell.dataset.signature = signature;
        }
        cell.title = `${coord(r, c)}｜${unit ? UI.unitTitle(unit) : "空格"}`;
        cell.setAttribute("aria-label", cell.title);
        for (const pid of [1, 2]) cell.classList.toggle(`final-five-p${pid}`, Boolean(view.gameOver && UI.finalFiveOwner(view, r, c) === pid));
      }
    }
    function paintSelection(view, from, blocked) {
      for (const cell of cells) {
        cell.classList.remove("draftTarget", "moveOrigin", "legalMove");
        cell.querySelector(".draftGhost")?.remove();
      }
      if (!view || blocked) return;
      if (from) {
        cells[from[0] * 9 + from[1]]?.classList.add("moveOrigin");
        for (const move of view.legalMoves || []) {
          if (move.from[0] === from[0] && move.from[1] === from[1]) cells[move.to[0] * 9 + move.to[1]]?.classList.add("legalMove");
        }
      }
      if (!draft) return;
      const intent = draft.intent;
      const r = intent.kind === "move" ? intent.toR : intent.r, c = intent.kind === "move" ? intent.toC : intent.c;
      const cell = cells[r * 9 + c];
      if (!cell) return;
      cell.classList.add("draftTarget");
      if (intent.kind !== "artillery") {
        const type = intent.type || view.board[intent.r]?.[intent.c]?.type;
        const ghost = document.createElement("span");
        ghost.className = `draftGhost unit p${view.selfPid}`; ghost.innerHTML = icon(type);
        ghost.setAttribute("aria-hidden", "true"); cell.appendChild(ghost);
      }
    }
    function renderHand({ view, selectedType, selectedRank, blocked, onSelect, onRank, onInspect }) {
      const hand = $("hand"), previous = document.activeElement;
      const focusIndex = hand.contains(previous) ? [...hand.children].indexOf(previous) : -1;
      const focusedRank = $("rankRow").contains(previous) ? previous?.dataset.rank : null;
      hand.replaceChildren(); $("rankRow").replaceChildren();
      const cat = view.unitCatalog, ranks = view.deploymentRules.ranks;
      const cost = ranks.find(option => option.rank === selectedRank)?.cost || 0;
      let marked = 0;
      for (const type of view.own.hand) {
        const card = document.createElement("button");
        const consumed = !blocked && selectedType === type && marked++ < cost;
        card.type = "button"; card.className = `card ${consumed ? "sel" : ""}`;
        card.disabled = Boolean(blocked); card.title = blocked || cat[type].name;
        card.setAttribute("aria-label", `${cat[type].name}${consumed ? "，將消耗" : ""}${blocked ? `，${blocked}` : ""}`);
        card.innerHTML = `<img class="handPortrait" src="${portrait(type, 1)}" alt="" decoding="async">${icon(type)}<span class="name">${UI.NAMES[type]}</span><span class="cardTag">${consumed ? "將消耗" : UI.SHORT_TAG[type]}</span>`;
        card.onclick = () => { inspectedId = null; clearDraft(); tone(); onSelect(type); };
        card.onmouseenter = () => onInspect(type); card.onmouseleave = () => onInspect(null);
        card.onfocus = () => onInspect(type); card.onblur = () => onInspect(null);
        hand.appendChild(card);
      }
      $("handTitle").textContent = `手牌 · ${view.own.hand.length}`;
      $("deckInfo").textContent = `牌庫 ${view.own.deckCount}｜冷卻 ${view.own.cooldown.length}`;
      $("deckInfo").title = view.own.cooldown.map(item => `${UI.NAMES[item.type]}：${item.turns}`).join("、") || "沒有冷卻中的牌";
      const count = view.own.hand.filter(type => type === selectedType).length;
      const eliteOut = view.board.flat().some(unit => unit && unit.pid === view.selfPid && unit.rank > 1 && unit.type === selectedType);
      for (const { rank, cost: needed } of ranks) {
        const reason = blocked || (!selectedType ? "請先選牌" : UI.rankDisabledReason({
          count, cost: needed, capped: rank > 1 && eliteOut, typeName: UI.NAMES[selectedType],
        }));
        const button = document.createElement("button");
        button.type = "button"; button.dataset.rank = rank;
        button.className = `btn ${selectedRank === rank ? "active" : ""}`;
        button.disabled = Boolean(reason); button.title = reason;
        setButton(button, `${"★".repeat(rank)} ${rank === 1 ? "普通" : "精英"}`, reason || `消耗 ${needed} 張`);
        button.onclick = () => { clearDraft(); inspectedId = null; onRank(rank); };
        $("rankRow").appendChild(button);
      }
      if (focusIndex >= 0 && hand.children[focusIndex] && !hand.children[focusIndex].disabled) hand.children[focusIndex].focus({ preventScroll: true });
      if (focusedRank) $("rankRow").querySelector(`[data-rank="${focusedRank}"]:not(:disabled)`)?.focus({ preventScroll: true });
    }
    function detail(type, rank, catalog, eliteCost) {
      const unit = currentView?.board.flat().find(item => item?.id === inspectedId);
      if (unit) { type = unit.type; rank = unit.rank; }
      UI.renderCardDetail($("cardDetail"), type, catalog, rank, eliteCost, unit);
      if (dialog.open) $("unitDialogBody").innerHTML = $("cardDetail").innerHTML;
    }
    function update({ view, blocked, selectedType, selectedRank, artilleryMode, moveFrom, confirm, cancel }) {
      callbacks = { confirm, cancel };
      if (!view) { sync(null, ""); dialog.close(); return; }
      $("roundText").textContent = `第 ${view.roundNo} 輪`; $("compactRound").textContent = `第 ${view.roundNo} 輪`;
      $("roundKind").textContent = view.gameOver ? "對局結束" : view.overtime ? "加賽" : "一般對局";
      [view.firstPlayer, 3 - view.firstPlayer].forEach((pid, index) => {
        const item = $(index ? "flowSecond" : "flowFirst");
        item.textContent = `P${pid} · ${pid === view.selfPid ? "你的行動" : "對手行動"}`;
        item.classList.toggle("active", !view.gameOver && view.current === pid && !blocked?.includes("演出"));
      });
      $("flowCombat").classList.toggle("active", Boolean(blocked?.includes("演出")));
      if (!$("counterLegend").childElementCount) {
        for (const [type, info] of Object.entries(view.unitCatalog)) {
          const item = document.createElement("div"); item.innerHTML = icon(type);
          const label = document.createElement("span"); label.textContent = `${info.name}　克制　${UI.NAMES[info.counters]}`;
          item.appendChild(label); $("counterLegend").appendChild(item);
        }
      }
      setButton($("artilleryBtn"), `${artilleryMode ? "瞄準中" : "炮擊"} · ${view.artillery[view.selfPid]}`, $("artilleryBtn").title);
      setButton($("endTurnBtn"), "結束回合", $("endTurnBtn").title);
      paintSelection(view, moveFrom, blocked);
      const confirmButton = $("confirmActionBtn");
      $("cancelActionBtn").disabled = Boolean(blocked) || !(draft || selectedType || artilleryMode || moveFrom);
      confirmButton.disabled = Boolean(blocked) || !draft;
      let label = "請選擇手牌", description = "先選牌，再選棋格；確認後送出。";
      if (blocked) { label = blocked; description = blocked; }
      else if (draft) {
        const intent = draft.intent;
        const r = intent.kind === "move" ? intent.toR : intent.r, c = intent.kind === "move" ? intent.toC : intent.c;
        label = `確認${{ deploy: "部署", move: "移動", artillery: "炮擊" }[intent.kind]} · ${coord(r, c)}`;
        if (intent.kind === "deploy") description = `${"★".repeat(intent.rank)}${UI.NAMES[intent.type]}｜消耗 ${view.deploymentRules.ranks.find(option => option.rank === intent.rank).cost} 張｜${coord(r, c)}`;
        else if (intent.kind === "move") description = `${coord(intent.r, intent.c)} → ${coord(r, c)}｜確認後仍可炮擊`;
        else {
          const plan = UI.forecastArtillery(view.board, r, c, view.artilleryRules, view.selfPid);
          description = `${coord(r, c)}｜敵軍 ${plan.enemies}、友軍 ${plan.allies}${plan.allies ? "（會傷及友軍）" : ""}`;
        }
      } else if (artilleryMode) { label = "請選炮擊中心"; description = "點選中心後，可確認或取消炮擊。"; }
      else if (view.deploymentCommitted) { label = "主要行動已完成"; description = "仍可炮擊，然後按「結束回合」。"; }
      else if (moveFrom) { label = "請選移動目的地"; description = `起點 ${coord(...moveFrom)}｜選取標示的合法空格`; }
      else if (view.legalMoves?.length) { label = "請選要移動的棋子"; description = "手牌用盡，選擇自己的棋子移動。"; }
      else if (selectedType) { label = "請選部署位置"; description = `已選 ${"★".repeat(selectedRank)}${UI.NAMES[selectedType]}，再點空格預覽。`; }
      setButton(confirmButton, label); $("selectionStatus").textContent = description;
      host.querySelector(".handPanel").classList.toggle("inactive-turn", Boolean(blocked || view.deploymentCommitted));
    }
    return { renderBoard, renderHand, detail, update, sync, setDraft, clearDraft,
      draft: () => draft?.intent || null, inspect: unit => { inspectedId = unit?.id || null; }, clearInspect: () => { inspectedId = null; } };
  }
  globalThis.BattleDesign = { mount, icon, portrait, coord };
})();
