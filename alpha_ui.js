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
  // 加賽／消極判負的參數一律向引擎要，UI 不自己抄 3 輪或 10%。
  function liveOvertimeRules() {
    const engine = globalThis.FiveLineEngine && globalThis.FiveLineEngine.GameEngine;
    return engine && engine.overtimeRules ? engine.overtimeRules() : null;
  }

  function rulesHtml(catalog) {
    const ot = liveOvertimeRules();
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
        <li>雙方<b>同一回合</b>都達成五連時不判平手，改為進入<b>加賽</b>。</li>
      </ul>

      <h3>加賽</h3>
      <ul>
        <li>進入加賽後，<b>只有單方五連才判勝</b>；雙方都有或雙方都沒有，對局繼續。</li>
        <li>加賽期間<b>照常部署新棋、照常結算戰鬥</b>。</li>
        ${ot ? `<li>加賽第 ${ot.graceRounds} 輪過後，之後每一輪<b>全場所有單位</b>扣除`
          + ` <b>最大生命的 ${Math.round(ot.decayRate * 100)}%</b>，敵我一視同仁。</li>`
          + `<li>線會被扣血打斷，所以撐得久的一方獲勝——用高生命的兵種組線在加賽比較有利。</li>` : ""}
      </ul>

      <h3>消極對局</h3>
      <ul>
        ${ot ? `<li><b>雙方</b>連續 ${ot.passivityForfeitRounds} 輪都沒有發生任何戰鬥，`
          + `視為消極對局，<b>雙方棄賽、判雙敗</b>。</li>` : ""}
        <li>只要該回合有任何一場戰鬥發生，計數就<b>歸零重算</b>。</li>
        <li>單方閃避不會構成消極——不去接觸對手就等於不擋對方的線，那本來就會輸得更快。</li>
      </ul>

      <h3>回合流程</h3>
      <ul>
        <li>每回合雙方各部署 1 顆棋。</li>
        <li>兩人都行動完後，一次結算全場戰鬥。</li>
        <li>戰鬥順序：主攻擊與護衛轉移　→　主傷害與移除陣亡　→　★★劍斬入／追擊　→　★★盾反震。</li>
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

      <h3>手牌用盡時</h3>
      <ul>
        <li>輪到你但手牌已空時，改為<b>移動自己的一顆棋</b>：往上下左右相鄰的空格走一格。</li>
        <li>移動<b>取代</b>本回合的部署，不是額外行動；還有手牌可以部署時不能改用移動。</li>
        <li>移動照樣佔掉本回合，之後照常結算戰鬥。</li>
        <li>沒牌又沒有任何可移動的棋子時，這一回合<b>自動跳過</b>，不判輸。</li>
        <li>陣亡單位的牌會在冷卻後回到牌庫，所以「沒牌」只是暫時的。</li>
      </ul>

      <h3>炮擊</h3>
      <ul>
        <li>每人整場 <b>2 發</b>。</li>
        <li>只能在自己<b>部署之前</b>使用，每回合最多 1 發；用完仍然必須完成部署。</li>
        <li>以指定格為中心的 3×3 範圍：<b>中心 30 點</b>、外圈 8 格<b>各 12 點</b>。</li>
        <li><b>會誤傷自己的單位</b>，範圍內不分敵我。</li>
      </ul>`;
  }

  // ---- 戰鬥預演 ----
  // 複製目前盤面到一個拋棄式引擎，跑一次正式 resolveCombat，取得完整的攻擊關係。
  // 前端不做任何傷害計算，互剋／方向分攤／護衛／斬入／反震全部來自 game_engine.js。
  // 盤面是公開資訊，所以連線模式在前端預演不構成作弊。
  let scratch = null;
  function forecast(board, ghost) {
    const engine = globalThis.FiveLineEngine && globalThis.FiveLineEngine.GameEngine;
    if (!engine || !board) return null;
    if (!scratch) scratch = new engine({ randomInt: () => 0 });
    scratch.board = board.map(row => row.map(unit => (unit ? { ...unit } : null)));
    // ghost：把「打算放下的那顆棋」也算進去，玩家就能看到落子後會發生什麼
    if (ghost && !scratch.board[ghost.r][ghost.c]) scratch.board[ghost.r][ghost.c] = { ...ghost.unit };
    scratch.logs = [];
    return scratch.resolveCombat();
  }

  // 針對某一格，整理出「它打誰、誰打它、會不會死」
  function focusOn(result, r, c) {
    if (!result) return null;
    const at = (a, b) => a.r === r && a.c === b;
    const outgoing = result.packets.filter(p => p.from.r === r && p.from.c === c);
    const incoming = result.packets.filter(p => p.to.r === r && p.to.c === c);
    const merge = list => {
      const map = new Map();
      for (const p of list) {
        const key = `${p.to.r},${p.to.c},${p.from.r},${p.from.c}`;
        map.set(key, (map.get(key) || 0) + p.amount);
      }
      return [...map].map(([key, amount]) => {
        const [tr, tc, fr, fc] = key.split(",").map(Number);
        return { from: { r: fr, c: fc }, to: { r: tr, c: tc }, amount: Math.round(amount) };
      });
    };
    const dies = cell => result.deaths.some(d => d.r === cell.r && d.c === cell.c)
      || result.damage.some(d => d.r === cell.r && d.c === cell.c && d.hpAfter <= 0);
    return { outgoing: merge(outgoing), incoming: merge(incoming), selfDies: dies({ r, c }) };
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

  // ---- 攻擊指示層 ----
  // 疊在棋盤上的 SVG。pointer-events:none，完全不影響點擊與版面。
  const SVG_NS = "http://www.w3.org/2000/svg";
  function drawForecast(layer, boardEl, view, focus) {
    if (!layer || !boardEl) return;
    layer.innerHTML = "";
    const size = boardEl.clientWidth;
    if (!size || !view) { layer.setAttribute("viewBox", "0 0 1 1"); return; }
    const cell = size / 9;
    layer.setAttribute("viewBox", `0 0 ${size} ${size}`);
    layer.style.width = `${size}px`;
    layer.style.height = `${size}px`;
    // 對齊到棋盤的內容區：getBoundingClientRect 含邊框，clientWidth 不含，
    // 所以要補上 clientLeft/clientTop（＝邊框寬度）才會剛好疊合。
    const rect = boardEl.getBoundingClientRect();
    const wrap = layer.parentElement.getBoundingClientRect();
    layer.style.left = `${rect.left - wrap.left + boardEl.clientLeft}px`;
    layer.style.top = `${rect.top - wrap.top + boardEl.clientTop}px`;
    const center = (r, c) => [c * cell + cell / 2, r * cell + cell / 2];

    const add = (tag, attrs, text) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      layer.appendChild(node);
      return node;
    };

    // 箭頭：從攻擊者指向目標，中點標預測傷害
    const arrow = (from, to, amount, kind) => {
      const [x1, y1] = center(from.r, from.c);
      const [x2, y2] = center(to.r, to.c);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const inset = cell * 0.34;
      const sx = x1 + dx / len * inset, sy = y1 + dy / len * inset;
      const ex = x2 - dx / len * inset, ey = y2 - dy / len * inset;
      add("line", { x1: sx, y1: sy, x2: ex, y2: ey, class: `fcLine ${kind}` });
      add("polygon", {
        class: `fcHead ${kind}`,
        points: [[0, -4], [9, 0], [0, 4]].map(([px, py]) => `${px},${py}`).join(" "),
        transform: `translate(${ex} ${ey}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`,
      });
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      add("rect", { class: `fcChipBg ${kind}`, x: mx - 15, y: my - 10, width: 30, height: 18, rx: 9 });
      add("text", { class: `fcChip ${kind}`, x: mx, y: my + 3.5 }, amount);
    };

    for (const packet of focus.incoming) arrow(packet.from, packet.to, packet.amount, "in");
    for (const packet of focus.outgoing) arrow(packet.from, packet.to, packet.amount, "out");

    // 這一輪會陣亡的單位加紅框
    for (const death of view.deaths) {
      add("rect", { class: "fcDoom", x: death.c * cell + 2, y: death.r * cell + 2,
        width: cell - 4, height: cell - 4, rx: 6 });
    }
    // ★★劍斬入的移動軌跡
    for (const cleave of view.cleaves || []) {
      const [x1, y1] = center(cleave.from.r, cleave.from.c);
      const [x2, y2] = center(cleave.to.r, cleave.to.c);
      add("line", { x1, y1, x2, y2, class: "fcCleave" });
    }
  }

  // ---- 炮擊預覽 ----
  // 炮只有 2 發而且會誤傷自己，盲射代價太高。用引擎給的參數算出每格傷害與死亡預測。
  function forecastArtillery(board, r, c, rules, selfPid) {
    if (!board || !rules) return null;
    const hits = [];
    for (let rr = r - rules.radius; rr <= r + rules.radius; rr++) {
      for (let cc = c - rules.radius; cc <= c + rules.radius; cc++) {
        if (rr < 0 || cc < 0 || rr > 8 || cc > 8) continue;
        const damage = rr === r && cc === c ? rules.center : rules.outer;
        const unit = board[rr][cc];
        hits.push({ r: rr, c: cc, damage, unit,
          friendly: Boolean(unit && unit.pid === selfPid),
          dies: Boolean(unit && unit.hp - damage <= 0) });
      }
    }
    return {
      hits,
      enemies: hits.filter(h => h.unit && !h.friendly).length,
      allies: hits.filter(h => h.friendly).length,
      kills: hits.filter(h => h.dies && !h.friendly).length,
      losses: hits.filter(h => h.dies && h.friendly).length,
    };
  }

  function drawArtillery(layer, boardEl, plan) {
    if (!layer || !boardEl) return;
    layer.innerHTML = "";
    const size = boardEl.clientWidth;
    if (!size || !plan) return;
    const cell = size / 9;
    layer.setAttribute("viewBox", `0 0 ${size} ${size}`);
    layer.style.width = `${size}px`;
    layer.style.height = `${size}px`;
    const rect = boardEl.getBoundingClientRect();
    const wrap = layer.parentElement.getBoundingClientRect();
    layer.style.left = `${rect.left - wrap.left + boardEl.clientLeft}px`;
    layer.style.top = `${rect.top - wrap.top + boardEl.clientTop}px`;

    const add = (tag, attrs, text) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      layer.appendChild(node);
    };
    for (const hit of plan.hits) {
      const x = hit.c * cell, y = hit.r * cell;
      const kind = hit.friendly ? "ally" : hit.unit ? "foe" : "empty";
      add("rect", { class: `artCell ${kind}`, x: x + 2, y: y + 2, width: cell - 4, height: cell - 4, rx: 6 });
      if (!hit.unit) continue;
      add("rect", { class: `fcChipBg ${hit.friendly ? "in" : "out"}`,
        x: x + cell / 2 - 15, y: y + cell - 22, width: 30, height: 18, rx: 9 });
      add("text", { class: `fcChip ${hit.friendly ? "in" : "out"}`,
        x: x + cell / 2, y: y + cell - 8.5 }, `-${hit.damage}`);
      if (hit.dies) add("rect", { class: "fcDoom", x: x + 2, y: y + 2, width: cell - 4, height: cell - 4, rx: 6 });
    }
  }

  // ---- 正式戰鬥演出 ----
  // 只播放引擎送來的 lastCombat；這裡不重新計算傷害、護衛、斬入或反震。
  function hasCombatPlayback(cue) {
    return Boolean(cue && ((cue.packets || []).length || (cue.damage || []).length
      || (cue.cleaves || []).length || (cue.reflections || []).length));
  }

  function createCombatPlayback({ boardEl, stageEl, svgEl, piecesEl, labelEl, skipButton, onFinish }) {
    if (!boardEl || !stageEl || !svgEl || !piecesEl || !labelEl || !skipButton) {
      return { play: () => false, skip() {}, reset() {}, active: () => false };
    }

    let timer = null;
    let running = false;
    let cue = null;
    let hiddenUnits = [];
    const deathPieces = new Map();
    const cleavePieces = new Map();

    function align() {
      const size = boardEl.clientWidth;
      if (!size) return;
      const rect = boardEl.getBoundingClientRect();
      const wrap = stageEl.parentElement.getBoundingClientRect();
      stageEl.style.left = `${rect.left - wrap.left + boardEl.clientLeft}px`;
      stageEl.style.top = `${rect.top - wrap.top + boardEl.clientTop}px`;
      stageEl.style.width = `${size}px`;
      stageEl.style.height = `${size}px`;
      svgEl.setAttribute("viewBox", `0 0 ${size} ${size}`);
    }

    const center = point => {
      const cell = boardEl.clientWidth / 9;
      return [point.c * cell + cell / 2, point.r * cell + cell / 2];
    };

    function svgNode(tag, attrs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      svgEl.appendChild(node);
      return node;
    }

    function arrow(from, to, className) {
      const [x1, y1] = center(from);
      const [x2, y2] = center(to);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const inset = boardEl.clientWidth / 9 * 0.3;
      const sx = x1 + dx / len * inset, sy = y1 + dy / len * inset;
      const ex = x2 - dx / len * inset, ey = y2 - dy / len * inset;
      svgNode("line", { x1: sx, y1: sy, x2: ex, y2: ey, class: `combatArrow ${className}` });
      svgNode("polygon", {
        class: `combatArrowHead ${className}`,
        points: "0,-4 10,0 0,4",
        transform: `translate(${ex} ${ey}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`,
      });
    }

    function line(from, to, className) {
      const [x1, y1] = center(from);
      const [x2, y2] = center(to);
      svgNode("line", { x1, y1, x2, y2, class: className });
    }

    function place(node, point) {
      node.style.left = `${(point.c + 0.5) / 9 * 100}%`;
      node.style.top = `${(point.r + 0.5) / 9 * 100}%`;
    }

    function makePiece(unit, point, extraClass = "") {
      const piece = document.createElement("div");
      piece.className = `combatPiece p${unit.pid} ${extraClass}`.trim();
      piece.dataset.unitId = String(unit.id ?? unit.unitId ?? "");
      const stars = document.createElement("span");
      stars.className = "combatPieceStars";
      stars.textContent = "★".repeat(unit.rank || 1);
      const icon = document.createElement("span");
      icon.className = "combatPieceIcon";
      icon.textContent = ICONS[unit.type] || "●";
      piece.append(stars, icon);
      place(piece, point);
      piecesEl.appendChild(piece);
      return piece;
    }

    function effect(text, point, className) {
      const node = document.createElement("div");
      node.className = `combatEffect ${className}`;
      node.textContent = text;
      place(node, point);
      piecesEl.appendChild(node);
      return node;
    }

    function clearEffects() {
      svgEl.innerHTML = "";
      for (const node of piecesEl.querySelectorAll(".combatEffect")) node.remove();
    }

    function hideFinalCleaveUnits() {
      const ids = new Set((cue.cleaves || []).map(item => String(item.unitId)));
      hiddenUnits = [...boardEl.querySelectorAll("[data-unit-id]")]
        .filter(node => ids.has(node.dataset.unitId));
      for (const node of hiddenUnits) node.classList.add("combatUnitHidden");
    }

    function preparePieces() {
      piecesEl.innerHTML = "";
      deathPieces.clear();
      cleavePieces.clear();
      hideFinalCleaveUnits();
      const cleaveIds = new Set((cue.cleaves || []).map(item => String(item.unitId)));
      for (const death of cue.deaths || []) {
        if (cleaveIds.has(String(death.unit.id))) continue;
        const piece = makePiece(death.unit, death, "combatDeathPiece");
        piece.dataset.deathPhase = death.phase || "main";
        deathPieces.set(String(death.unit.id), piece);
      }
      for (const cleave of cue.cleaves || []) {
        const piece = makePiece({
          id: cleave.unitId, pid: cleave.pid, type: cleave.type, rank: cleave.rank,
        }, cleave.from, "combatCleavePiece");
        const laterDeath = (cue.deaths || []).find(item => String(item.unit.id) === String(cleave.unitId));
        if (laterDeath) {
          piece.classList.add("combatDeathPiece");
          piece.dataset.deathPhase = laterDeath.phase || "reflection";
          deathPieces.set(String(cleave.unitId), piece);
        }
        cleavePieces.set(String(cleave.unitId), piece);
      }
    }

    function fadeDeaths(phase) {
      for (const piece of deathPieces.values()) {
        if (piece.dataset.deathPhase === phase) piece.classList.add("combatDeathFading");
      }
    }

    function renderAttack() {
      clearEffects();
      for (const packet of cue.packets || []) arrow(packet.from, packet.to, `p${packet.from.pid}`);
      for (const [targetKey, guards] of Object.entries(cue.guards || {})) {
        const [r, c] = targetKey.split(",").map(Number);
        for (const guard of guards) line({ r, c }, guard, "combatGuardLine");
      }
    }

    function renderDamage() {
      clearEffects();
      for (const hit of cue.damage || []) {
        effect(`-${hit.damage}`, hit, `combatDamage p${hit.pid}`);
        effect("", hit, "combatImpact");
      }
      fadeDeaths("main");
    }

    function renderCleave() {
      clearEffects();
      const cell = boardEl.clientWidth / 9;
      for (const item of cue.cleaves || []) {
        line(item.from, item.to, "combatCleavePath");
        const piece = cleavePieces.get(String(item.unitId));
        if (piece) {
          piece.style.setProperty("--combat-dx", `${(item.to.c - item.from.c) * cell}px`);
          piece.style.setProperty("--combat-dy", `${(item.to.r - item.from.r) * cell}px`);
          piece.classList.add("combatCleaveMoving");
        }
        if (item.followUp) {
          arrow(item.to, item.followUp, `cleave p${item.pid}`);
          effect(`-${item.followUp.damage}`, item.followUp, `combatDamage cleave p${item.pid}`);
        }
      }
      fadeDeaths("cleave");
    }

    function finishCleave() {
      for (const item of cue?.cleaves || []) {
        const piece = cleavePieces.get(String(item.unitId));
        if (!piece) continue;
        if (deathPieces.get(String(item.unitId)) === piece) {
          piece.classList.remove("combatCleaveMoving");
          piece.style.removeProperty("--combat-dx");
          piece.style.removeProperty("--combat-dy");
          place(piece, item.to);
        } else piece.remove();
      }
      cleavePieces.clear();
      for (const node of hiddenUnits) node.classList.remove("combatUnitHidden");
      hiddenUnits = [];
    }

    function renderReflection() {
      finishCleave();
      clearEffects();
      for (const item of cue.reflections || []) {
        if (item.from) arrow(item.from, item, "reflection");
        effect(`-${item.damage}`, item, "combatDamage reflection");
      }
      fadeDeaths("reflection");
    }

    function cleanup(notify) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      finishCleave();
      svgEl.innerHTML = "";
      piecesEl.innerHTML = "";
      deathPieces.clear();
      stageEl.classList.add("hidden");
      labelEl.textContent = "";
      running = false;
      const finishedCue = cue;
      cue = null;
      if (notify && typeof onFinish === "function") onFinish(finishedCue);
    }

    function play(nextCue) {
      if (!hasCombatPlayback(nextCue)) return false;
      if (running) cleanup(false);
      cue = nextCue;
      running = true;
      align();
      preparePieces();
      stageEl.classList.remove("hidden");

      const steps = [
        { label: "主攻擊｜護衛轉移", duration: 820, render: renderAttack },
        { label: "傷害與陣亡", duration: 880, render: renderDamage },
      ];
      if ((cue.cleaves || []).length) {
        steps.push({ label: "★★劍斬入｜追擊", duration: 920, render: renderCleave, after: finishCleave });
      }
      if ((cue.reflections || []).length) {
        steps.push({ label: "★★盾反震", duration: 820, render: renderReflection });
      }

      let index = 0;
      const next = () => {
        if (!running) return;
        if (index >= steps.length) { cleanup(true); return; }
        const step = steps[index++];
        labelEl.textContent = `第 ${cue.round} 輪｜${step.label}`;
        step.render();
        timer = setTimeout(() => {
          timer = null;
          if (step.after) step.after();
          next();
        }, step.duration);
      };
      next();
      return true;
    }

    function skip() {
      if (running) cleanup(true);
    }

    function reset() {
      cleanup(false);
    }

    skipButton.onclick = skip;
    globalThis.addEventListener("resize", () => { if (running) align(); });
    return { play, skip, reset, active: () => running };
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

  // 加賽／消極倒數的統一文案。兩個客戶端共用，數值一律從引擎送來的
  // overtimeRules 讀，UI 不自己抄 3 輪或 10%。
  // 回傳 { text, full, level }。
  // text 是要塞進固定寬警示條的緊湊版（實測側欄只有約 200px，
  // 完整句子會被 ellipsis 截掉）；full 給 title 當補充說明。
  // 數值一律從引擎送來的 overtimeRules 讀，UI 不自己抄 3 輪或 10%。
  const RANK = { none: 0, info: 1, warn: 2, danger: 3 };
  function matchPhaseLabel(view) {
    const empty = { text: "", full: "", level: "none" };
    if (!view) return empty;
    const rules = view.overtimeRules || {};

    const round = view.overtimeRound || 0;
    const grace = rules.graceRounds ?? 0;
    const pct = Math.round((rules.decayRate ?? 0) * 100);
    const decaying = round > grace;
    const inOvertime = Boolean(view.overtime);

    const limit = view.passivityForfeitRounds ?? rules.passivityForfeitRounds;
    const quiet = view.quietRounds || 0;
    const quietLeft = limit ? limit - quiet : 0;
    const warnQuiet = Boolean(limit && quiet > 0);

    if (!inOvertime && !warnQuiet) return empty;

    // 兩則同時出現時，兩邊都再縮一級才塞得下
    const both = inOvertime && warnQuiet;
    const text = [], full = [];
    if (inOvertime) {
      full.push(decaying
        ? `加賽第 ${round} 輪：每輪全場扣最大生命的 ${pct}%`
        : `加賽第 ${round} 輪：再 ${grace - round + 1} 輪後開始全場扣血`);
      text.push(both ? `⚔ 加賽 ${round}`
        : decaying ? `⚔ 加賽 ${round}｜每輪 -${pct}% HP`
          : `⚔ 加賽 ${round}｜${grace - round + 1} 輪後扣血`);
    }
    if (warnQuiet) {
      full.push(`雙方已連續 ${quiet} 輪沒有任何戰鬥，再 ${quietLeft} 輪雙方棄賽判雙敗`);
      text.push(both ? `⚠ 再 ${quietLeft} 輪雙敗` : `⚠ ${quiet} 輪未交戰｜再 ${quietLeft} 輪雙敗`);
    }

    let level = "none";
    const raise = next => { if (RANK[next] > RANK[level]) level = next; };
    if (inOvertime) raise(decaying ? "warn" : "info");
    // 最後一次機會要最醒目。部署不限落點，隨時可以貼上去製造交戰，
    // 所以即使只剩 1 輪這個警告仍然是可行動的。
    if (warnQuiet) raise(quietLeft <= 1 ? "danger" : "warn");

    return { text: text.join("　"), full: full.join("；"), level };
  }

  // 單機與連線共用的終局文案；endReason 由權威引擎提供，避免兩端各自猜測。
  // 單機與連線共用的終局文案；endReason 由權威引擎提供，避免兩端各自猜測。
  function resultLabel(view) {
    if (!view || !view.gameOver) return "";
    if (view.winner === "double_loss") return "消極對局：雙方棄賽";
    if (view.winner === "draw") return "雙方同輪五連：平手";
    return `P${view.winner} 獲勝${view.endReason === "five_line" && view.overtime ? "（加賽）" : ""}`;
  }

  // 終局原因只翻譯引擎已經判定好的 endReason，不在 UI 重新推導勝負。
  function resultReasonLabel(view) {
    if (!view || !view.gameOver) return "";
    if (view.winner === "draw") return "雙方在同一輪完成五連，判定平手。";
    if (view.endReason === "passivity_forfeit" || view.winner === "double_loss") {
      const live = liveOvertimeRules();
      const rounds = view.passivityForfeitRounds
        ?? view.overtimeRules?.passivityForfeitRounds
        ?? live?.passivityForfeitRounds;
      return rounds
        ? `雙方連續 ${rounds} 輪未發生戰鬥，依規則判雙方棄賽。`
        : "雙方持續未發生戰鬥，依消極對局規則判雙方棄賽。";
    }
    if (view.endReason === "five_line") {
      return view.overtime
        ? `P${view.winner} 在加賽戰鬥結算後維持五連；棋盤金框標示致勝五顆。`
        : `P${view.winner} 在戰鬥結算後維持五連；棋盤金框標示致勝五顆。`;
    }
    return "對局已由引擎完成判定。";
  }

  // finalFive 是引擎送來的致勝線；這裡只把座標轉成棋盤顯示 class。
  function finalFiveOwner(view, r, c) {
    const lines = view?.finalFive;
    if (!lines) return 0;
    for (const [key, pid] of [["p1", 1], ["p2", 2]]) {
      for (const line of lines[key] || []) {
        if (line.some(cell => cell.r === r && cell.c === c)) return pid;
      }
    }
    return 0;
  }

  // 按鈕停用原因只整理伺服器／引擎已給的狀態，不複製任何規則數值。
  function artilleryDisabledReason({ turnReason = "", remaining, usedThisTurn, deploymentCommitted }) {
    if (turnReason) return turnReason;
    if (remaining <= 0) return "本場炮擊已用完";
    if (usedThisTurn) return "本回合已使用炮擊";
    if (deploymentCommitted) return "已完成部署，炮擊只能在部署前使用";
    return "";
  }

  function rankDisabledReason({ turnReason = "", count, cost, capped, typeName = "該兵種" }) {
    if (turnReason) return turnReason;
    if (capped) return `場上已有★★${typeName}`;
    if (count < cost) return `需要 ${cost} 張，目前只有 ${count} 張`;
    return "";
  }

  globalThis.AlphaUI = {
    ICONS, NAMES, SHORT_TAG, ELITE_TAG, ABILITY, ELITE_ABILITY,
    handCardHtml, unitHtml, unitTitle, cardDetailHtml, renderCardDetail, rulesHtml, wireRulesOverlay,
    autoSizeBoard, forecast, focusOn, drawForecast, forecastArtillery, drawArtillery,
    hasCombatPlayback, createCombatPlayback,
    matchPhaseLabel, resultLabel, resultReasonLabel, finalFiveOwner,
    artilleryDisabledReason, rankDisabledReason,
  };
})();
