// 單機（/local）與連線（/）共用的顯示層。
// 這裡只放「文案與 DOM 產生」，不含任何規則計算；所有數值一律取自 game_engine.js
// 的 GameEngine.unitCatalog()，前端不另外維護一份兵種數值。
(() => {
  const ICONS = { sword: "⚔", shield: "🛡", spear: "🔱" };
  const NAMES = { sword: "劍", shield: "盾", spear: "槍" };
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

  const eliteAtk = ranks => (ranks[2].attacks ? String(ranks[2].atk) : "—");

  // 手牌小卡：兵種、★／★★ 的 HP 與 ATK、一個很短的能力標籤
  function handCardHtml(type, catalog) {
    const stats = catalog
      ? `<span class="cardStats">★ HP${catalog[type].ranks[1].maxHp}／攻${catalog[type].ranks[1].atk}`
        + `<br>★★ HP${catalog[type].ranks[2].maxHp}／攻${eliteAtk(catalog[type].ranks)}</span>`
      : "";
    return `<span class="ico">${ICONS[type]}</span><span class="name">${NAMES[type]}</span>`
      + stats + `<span class="cardTag">${SHORT_TAG[type]}／★★${ELITE_TAG[type]}</span>`;
  }

  // 棋盤格內的單位
  function unitHtml(unit) {
    const pct = Math.max(0, Math.min(100, unit.hp / unit.maxHp * 100));
    return `<span class="stars">${"★".repeat(unit.rank)}</span>`
      + `<span class="unitIcon">${ICONS[unit.type]}</span>`
      + `<small>${Math.max(0, Math.round(unit.hp))}/${unit.maxHp}</small>`
      + `<span class="hpbar"><i style="width:${pct}%"></i></span>`;
  }
  const unitTitle = unit =>
    `P${unit.pid} ${NAMES[unit.type]} ${"★".repeat(unit.rank)}｜HP ${Math.round(unit.hp)}/${unit.maxHp}｜攻 ${unit.atk}`;

  // 卡牌詳情（固定區塊，不浮動、不蓋住棋盤）
  function cardDetailHtml(type, catalog) {
    if (!type || !catalog) return "滑鼠移到手牌上（或點選手牌）可看該兵種的詳細能力。";
    const info = catalog[type];
    const one = info.ranks[1], two = info.ranks[2];
    const twoAtk = two.attacks ? String(two.atk) : "—（不主動攻擊）";
    const list = lines => `<ul>${lines.map(item => `<li>${item}</li>`).join("")}</ul>`;
    return `<div class="detailHead">${ICONS[type]} ${info.name}</div>`
      + `<div class="detailMeta">★　HP ${one.maxHp}／攻 ${one.atk}　｜　★★　HP ${two.maxHp}／攻 ${twoAtk}<br>`
      + `克制：${NAMES[info.counters]}　｜　被克制：${NAMES[info.counteredBy]}　｜　★★ 需要 3 張同兵種卡</div>`
      + `<div class="detailAbility"><b>${ABILITY[type].tag}</b>${list(ABILITY[type].lines)}</div>`
      + `<div class="detailAbility"><b>★★ ${ELITE_ABILITY[type].tag}</b>${list(ELITE_ABILITY[type].lines)}</div>`;
  }

  // 規則視窗
  function rulesHtml(catalog) {
    const row = type => {
      const info = catalog[type], one = info.ranks[1];
      return `<tr><td>${ICONS[type]} ${info.name}</td><td>${one.maxHp}／${one.atk}</td>`
        + `<td>${info.ranks[2].maxHp}／${eliteAtk(info.ranks)}</td>`
        + `<td>${NAMES[info.counters]}</td><td>${NAMES[info.counteredBy]}</td></tr>`;
    };
    const statsTable = catalog
      ? `<table><tr><th>兵種</th><th>★ HP／攻</th><th>★★ HP／攻</th><th>克制</th><th>被克制</th></tr>`
        + ["sword", "shield", "spear"].map(row).join("") + `</table>`
      : "<p>（進入遊戲後會顯示實際數值）</p>";
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
        <li>兩人都行動完後，一次結算全場戰鬥。</li>
        <li>戰鬥順序：主戰鬥　→　★★劍斬入與追擊　→　護衛與反震　→　移除陣亡單位。</li>
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

  // 棋盤尺寸：量容器、直接寫像素。棋盤類遊戲的標準做法，不依賴 aspect-ratio /
  // max-height / 容器查詢這些會互相覆寫的規則，所以不會被壓扁或塌陷。
  // 取 9 的倍數，讓每一格都是整數像素、格線不會有半像素縫隙。
  function autoSizeBoard(boardEl, wrapEl) {
    if (!boardEl || !wrapEl) return;
    const apply = () => {
      const style = getComputedStyle(wrapEl);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const available = Math.min(wrapEl.clientWidth - padX, wrapEl.clientHeight - padY);
      const size = Math.max(180, Math.floor(available / 9) * 9);   // 保底 180px，避免容器暫時為 0
      boardEl.style.width = `${size}px`;
      boardEl.style.height = `${size}px`;
    };
    apply();
    requestAnimationFrame(apply);                                  // 首次版面完成後再算一次
    globalThis.addEventListener("load", apply);
    globalThis.addEventListener("resize", apply);
    if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(wrapEl);
    return apply;                                                  // 交給 render() 每次重算，不倚賴 RO 的時機
  }

  // 大卡詳情：沒有目標時整張卡隱藏（.idle），有目標才浮出。
  // 因為 .cardDetail 是 absolute，出現與消失都不會推擠版面。
  function renderCardDetail(box, type, catalog) {
    if (!box) return;
    if (!type || !catalog) { box.classList.add("idle"); box.innerHTML = ""; return; }
    box.classList.remove("idle");
    box.innerHTML = cardDetailHtml(type, catalog);
  }

  // 規則視窗的開關（兩邊共用；只切 CSS class，不動遊戲狀態）
  function wireRulesOverlay(getCatalog) {
    const overlay = document.querySelector("#rulesOverlay");
    if (!overlay) return { open() {}, close() {} };
    const body = document.querySelector("#rulesBody");
    const open = () => { body.innerHTML = rulesHtml(getCatalog()); overlay.classList.remove("hidden"); };
    const close = () => overlay.classList.add("hidden");
    const closeBtn = document.querySelector("#rulesCloseBtn");
    if (closeBtn) closeBtn.onclick = close;
    for (const id of ["#helpBtn", "#entryHelpBtn"]) {
      const button = document.querySelector(id);
      if (button) button.onclick = open;
    }
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    return { open, close };
  }

  globalThis.AlphaUI = {
    ICONS, NAMES, SHORT_TAG, ELITE_TAG, ABILITY, ELITE_ABILITY,
    handCardHtml, unitHtml, unitTitle, cardDetailHtml, renderCardDetail, rulesHtml, wireRulesOverlay,
    autoSizeBoard,
  };
})();
