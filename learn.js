// 獨立的操作教學：只呈現示意，不建立引擎對局、不連線、不使用回合計時器。
(() => {
  const { GameEngine } = globalThis.FiveLineEngine;
  const UI = globalThis.AlphaUI, design = globalThis.BattleDesign;
  const catalog = GameEngine.unitCatalog();
  const ranks = GameEngine.deploymentRules().ranks;
  const artillery = GameEngine.artilleryRules();
  const timeouts = GameEngine.timeoutRules();
  const $ = id => document.getElementById(id);
  const boardSize = 9;
  const lessons = [
    { label: "認識兵種", title: "先選擇適合的兵種", intro: "劍、盾、槍各有用途。點選兵種與星級，看看能力、相剋和耗牌差別。", panel: "unitPanel" },
    { label: "確認部署", title: "點格只是預覽，確認才部署", intro: "用剛才選的兵種，點一個空格。先看看位置與耗牌，再按金色確認鈕。", panel: "boardPanel" },
    { label: "炮擊預覽", title: "炮擊前，先看範圍內有誰", intro: "點選炮擊中心，觀察敵軍與友軍。炮擊會傷及友軍，確認之前都可以取消。", panel: "boardPanel" },
    { label: "結束回合", title: "主要行動完成後，記得結束回合", intro: "部署或移動不會自動換人。你仍可炮擊，完成後再按「結束回合」。", panel: "turnPanel" },
    { label: "看懂交戰", title: "五連要撐過交戰，才算獲勝", intro: "看懂攻擊、護衛、斬入與反震，才能理解為什麼交戰後盤面變了。", panel: "combatPanel" },
  ];
  let step = 0, type = "sword", rank = ranks[0].rank;
  let draft = null, deployed = null, artilleryDone = false, turnEnded = false;
  let boardMessage = "";
  const cells = [], navButtons = [];
  const cost = () => ranks.find(option => option.rank === rank).cost;
  const occupiedAt = (pieces, r, c) => pieces.find(piece => piece.r === r && piece.c === c);

  function resetExercise() {
    draft = null; deployed = null; artilleryDone = false; turnEnded = false; boardMessage = "";
  }
  function go(index) {
    step = Math.max(0, Math.min(lessons.length - 1, index));
    draft = null; boardMessage = "";
    render();
    $("lessonTitle").focus({ preventScroll: true });
    $("lessonTitle").scrollIntoView({ block: "nearest", behavior: "auto" });
  }
  for (const [index, lesson] of lessons.entries()) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = `${index + 1} · ${lesson.label}`;
    button.onclick = () => go(index);
    navButtons.push(button); $("stepNav").appendChild(button);
  }
  for (const [key, info] of Object.entries(catalog)) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "button"; button.dataset.type = key;
    button.innerHTML = design.icon(key);
    const name = document.createElement("span"); name.textContent = info.name;
    button.appendChild(name);
    button.onclick = () => { type = key; resetExercise(); render(); };
    $("typeChoices").appendChild(button);
  }
  for (const option of ranks) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "button"; button.dataset.rank = option.rank;
    const label = document.createElement("span");
    label.textContent = `${"★".repeat(option.rank)} ${option.rank === 1 ? "普通" : "精英"}`;
    const count = document.createElement("small"); count.textContent = `消耗 ${option.cost} 張同兵種`;
    button.append(label, count);
    button.onclick = () => { rank = option.rank; resetExercise(); render(); };
    $("rankChoices").appendChild(button);
  }
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const cell = document.createElement("button");
    cell.type = "button"; cell.className = "practiceCell"; cell.tabIndex = cells.length ? -1 : 0;
    cell.onclick = () => {
      if (step === 1 && deployed) {
        boardMessage = "部署已確認。可按「重新練習這一步」，或前往炮擊練習。";
      } else if (step === 2 && artilleryDone) {
        boardMessage = "炮擊確認練習已完成。可重新練習，或前往結束回合。";
      } else if (step === 1 && occupiedAt(piecesForStep(), r, c)) {
        boardMessage = "這個位置已有棋子，請選空格。";
      } else {
        draft = { r, c }; boardMessage = "";
      }
      renderPractice();
    };
    cell.onfocus = () => { for (const item of cells) item.tabIndex = item === cell ? 0 : -1; };
    cell.onkeydown = event => {
      const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const rr = Math.max(0, Math.min(boardSize - 1, r + delta[0]));
      const cc = Math.max(0, Math.min(boardSize - 1, c + delta[1]));
      cells[rr * boardSize + cc].focus();
    };
    cells.push(cell); $("practiceBoard").appendChild(cell);
  }

  function renderUnit() {
    for (const button of $("typeChoices").children) button.setAttribute("aria-pressed", String(button.dataset.type === type));
    for (const button of $("rankChoices").children) button.setAttribute("aria-pressed", String(Number(button.dataset.rank) === rank));
    $("costText").textContent = `${"★".repeat(rank)}${catalog[type].name}：確認部署會消耗 ${cost()} 張同兵種手牌。`;
    $("exampleHand").replaceChildren();
    const sampleCount = Math.max(...ranks.map(option => option.cost));
    for (let i = 0; i < sampleCount; i++) {
      const card = document.createElement("div");
      card.className = `exampleCard ${i < cost() ? "used" : ""}`;
      card.innerHTML = design.icon(type);
      const name = document.createElement("span"); name.textContent = catalog[type].name;
      const status = document.createElement("span"); status.textContent = i < cost() ? "將消耗" : "保留";
      card.append(name, status); $("exampleHand").appendChild(card);
    }
    UI.renderCardDetail($("unitDetail"), type, catalog, rank,
      ranks.find(option => option.rank === 2)?.cost);
  }
  function piecesForStep() {
    if (step !== 2) return deployed ? [deployed] : [];
    const own = deployed || { r: 4, c: 4, pid: 1, type, rank };
    const positions = [[4, 5], [3, 4], [4, 3], [3, 5]].filter(([r, c]) => r !== own.r || c !== own.c);
    return [own,
      { r: positions[0][0], c: positions[0][1], pid: 1, type: "shield", rank: ranks[0].rank },
      { r: positions[1][0], c: positions[1][1], pid: 2, type: "spear", rank: ranks[0].rank },
    ];
  }
  function paintPiece(cell, piece, preview = false) {
    const node = document.createElement("span");
    node.className = `samplePiece p${piece.pid} ${preview ? "preview" : ""}`;
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = design.icon(piece.type);
    const stars = document.createElement("span"); stars.className = "sampleStars"; stars.textContent = "★".repeat(piece.rank);
    node.appendChild(stars); cell.appendChild(node);
  }
  function blastHits(pieces) {
    return draft ? pieces.filter(piece =>
      Math.abs(piece.r - draft.r) <= artillery.radius && Math.abs(piece.c - draft.c) <= artillery.radius) : [];
  }
  function renderPractice() {
    const isArtillery = step === 2, pieces = piecesForStep();
    for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
      const cell = cells[r * boardSize + c], piece = occupiedAt(pieces, r, c);
      const selected = Boolean(draft && draft.r === r && draft.c === c);
      const inBlast = Boolean(isArtillery && draft && Math.abs(r - draft.r) <= artillery.radius && Math.abs(c - draft.c) <= artillery.radius);
      cell.replaceChildren(); cell.className = "practiceCell";
      cell.classList.toggle("selected", selected);
      cell.classList.toggle("inBlast", inBlast); cell.classList.toggle("blastCenter", inBlast && selected);
      let label = `${design.coord(r, c)}，${piece ? `P${piece.pid} ${"★".repeat(piece.rank)}${catalog[piece.type].name}` : "空格"}`;
      if (piece) paintPiece(cell, piece);
      if (!isArtillery && selected && !piece) paintPiece(cell, { pid: 1, type, rank }, true);
      if (inBlast) {
        const damage = selected ? artillery.center : artillery.outer;
        const badge = document.createElement("span"); badge.className = "sampleDamage"; badge.textContent = `−${damage}`;
        badge.setAttribute("aria-hidden", "true"); cell.appendChild(badge);
        label += `，炮擊範圍，傷害 ${damage}`;
      }
      cell.setAttribute("aria-label", label);
      cell.setAttribute("aria-pressed", String(selected)); cell.title = label;
    }
    $("boardMode").textContent = isArtillery ? "炮擊確認練習" : `部署 ${"★".repeat(rank)}${catalog[type].name}`;
    $("practiceHeading").textContent = isArtillery ? "先選中心，再確認" : "先看落點，再確認";
    $("practiceHint").textContent = isArtillery
      ? "實線金框是炮擊中心，淺色格是影響範圍。紅色圓棋是友軍，藍色八角棋是敵軍。"
      : "可以換落點、取消預覽。確認部署後，正式對局不能用「取消」撤回。";
    $("artilleryLegend").hidden = !isArtillery;
    $("artilleryRulesText").textContent = `每場每人 ${artillery.perPlayer} 發；中心傷害 ${artillery.center}，周圍傷害 ${artillery.outer}。本回合只能使用一次炮擊。`;
    const confirm = $("confirmPractice"), done = isArtillery ? artilleryDone : Boolean(deployed);
    confirm.disabled = !draft || done; $("cancelPractice").disabled = !draft;
    confirm.textContent = done ? "本步練習已完成" : draft
      ? `確認${isArtillery ? "炮擊" : "部署"} · ${design.coord(draft.r, draft.c)}`
      : "請先選棋格";
    let status = done
      ? isArtillery ? "炮擊確認練習完成。這裡只練習操作，不結算示意棋子的傷害。"
        : `已在 ${design.coord(deployed.r, deployed.c)} 確認部署。正式對局此時仍可炮擊，然後結束回合。`
      : !draft ? "點選棋格開始預覽；尚未確認前，不會提交行動。"
      : isArtillery ? (() => {
        const hits = blastHits(pieces), allies = hits.filter(piece => piece.pid === 1).length;
        return `中心 ${design.coord(draft.r, draft.c)}｜敵軍 ${hits.length - allies}、友軍 ${allies}。${allies ? "注意：會傷及友軍，請先確認。" : "可確認炮擊，或取消並重新瞄準。"}`;
      })() : `預覽 ${design.coord(draft.r, draft.c)}｜${"★".repeat(rank)}${catalog[type].name}｜消耗 ${cost()} 張。請按確認或取消。`;
    $("practiceStatus").textContent = boardMessage || status;
  }
  function render() {
    const lesson = lessons[step];
    $("stepCounter").textContent = `第 ${step + 1} 步 / 共 ${lessons.length} 步`;
    $("lessonTitle").textContent = lesson.title; $("lessonIntro").textContent = lesson.intro;
    for (const id of new Set(lessons.map(item => item.panel))) $(id).hidden = id !== lesson.panel;
    navButtons.forEach((button, index) => {
      if (index === step) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
    });
    if (step === 0) renderUnit();
    if (step === 1 || step === 2) renderPractice();
    const reason = UI.endTurnDisabledReason({ turnReason: "", deploymentCommitted: Boolean(deployed), canAct: true });
    $("endTurnPractice").disabled = Boolean(reason) || turnEnded;
    $("endTurnPractice").textContent = turnEnded ? "回合已結束" : "結束回合";
    $("turnPracticeStatus").textContent = turnEnded
      ? "結束回合練習完成。正式對局會換下一位玩家，雙方都結束後才全場交戰。"
      : reason ? `${reason}。請先回到部署練習，選格並按確認。`
        : "部署練習已完成。現在可練習炮擊，或直接按「結束回合」。";
    $("timeoutText").textContent = `每回合 ${timeouts.turnMs / 1000} 秒，逾時自動結束。斷線時暫停回合倒數；重連後續算，斷線滿 ${timeouts.disconnectMs / 1000} 秒判離。教學頁本身沒有倒數。`;
    $("reflectionText").textContent = UI.ELITE_ABILITY.shield.lines[2];
    const count = [Boolean(deployed), artilleryDone, turnEnded].filter(Boolean).length;
    $("completionText").textContent = `已完成 ${count}/3 項操作練習（部署、炮擊、結束回合）。可以先練習，也可以隨時開始單機對局。`;
    $("previousStep").disabled = step === 0;
    $("nextStep").textContent = step === lessons.length - 1 ? "返回大廳" : "下一步";
    $("progressText").textContent = `${step + 1} / ${lessons.length} · 可自由切換步驟`;
  }
  $("confirmPractice").onclick = () => {
    if (!draft || (step !== 1 && step !== 2)) return;
    if (step === 1 && !deployed) {
      deployed = { ...draft, pid: 1, type, rank }; turnEnded = false;
    } else if (step === 2 && !artilleryDone) artilleryDone = true;
    draft = null; boardMessage = ""; renderPractice();
  };
  $("cancelPractice").onclick = () => { draft = null; boardMessage = ""; renderPractice(); };
  $("resetPractice").onclick = () => {
    draft = null; boardMessage = "";
    if (step === 1) { deployed = null; artilleryDone = false; turnEnded = false; }
    else if (step === 2) artilleryDone = false;
    renderPractice();
  };
  $("reviewDeploy").onclick = () => go(1);
  $("reviewArtillery").onclick = () => go(2);
  $("endTurnPractice").onclick = () => { if (!deployed || turnEnded) return; turnEnded = true; render(); };
  $("previousStep").onclick = () => go(step - 1);
  $("nextStep").onclick = () => { if (step === lessons.length - 1) location.assign("/"); else go(step + 1); };
  $("restartLesson").onclick = () => { resetExercise(); go(0); };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && draft) { draft = null; boardMessage = ""; renderPractice(); }
  });
  render();
})();
