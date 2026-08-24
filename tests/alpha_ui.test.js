// Alpha UX 與單機／連線共用規則的檢查。
// 靜態部分檢查 HTML/JS/CSS 結構與文案；動態部分直接跑正式 GameEngine，
// 驗證 /local 拿到的就是 Alpha Core v1 規則。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { GameEngine, baseStats } = require("../game_engine");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const html = read("alpha.html");
const client = read("alpha_client.js");
const css = read("alpha_board.css");
const localHtml = read("index.html");
const localClient = read("local_client.js");
const sharedUi = read("alpha_ui.js");
const shellCss = read("game_shell.css");
const layoutCss = read("local_layout.css");
const server = read("server.js");
const stripComments = text => text.replace(/^\s*\/\/.*$/gm, "");

const fixed = () => new GameEngine({ randomInt: () => 0, turnOrderMode: "fixed", startingPlayer: 1 });
const intent = (engine, fields) => ({ ...fields, turnId: engine.turnId });
function bench() {
  const engine = fixed();
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  let id = 1;
  engine.put = (r, c, pid, type, rank, hp) => {
    const stats = baseStats(type, rank);
    const unit = { id: id++, pid, type, rank, cards: rank === 2 ? 3 : 1,
      hp: hp === undefined ? stats.maxHp : hp, maxHp: stats.maxHp, atk: stats.atk };
    engine.board[r][c] = unit;
    return unit;
  };
  return engine;
}

/* ---------------- 入口 ---------------- */

test("主要入口同時提供單機與連線兩個選項", () => {
  assert.match(html, /id="entryOverlay"/);
  assert.match(html, /id="entryOnlineBtn"[^>]*>[\s\S]*?連線對戰/);
  assert.match(html, /id="entryLocalBtn"[^>]*href="\/local"[\s\S]*?單機測試/);
  assert.match(html, /id="entryHelpBtn"[\s\S]*?規則/);
  assert.match(server, /\["\/", \["alpha\.html"/);
  assert.match(server, /\["\/local", \["index\.html"/);
});

test("兩種模式都不再標示為舊版原型", () => {
  assert.match(localHtml, /class="btn modeLink" href="\/">🌐 連線對戰/);
  assert.doesNotMatch(localHtml, /舊版原型|舊版規則/);
  assert.doesNotMatch(html, /舊版原型|舊版規則/);
  assert.match(html, /同一套規則引擎/);
});

test("連線對戰有建立房間、複製房號、加入房間、返回模式選擇", () => {
  assert.match(html, /id="createBtn"[\s\S]*?建立房間/);
  assert.match(html, /id="roomInput"/);
  assert.match(html, /id="joinBtn"[\s\S]*?加入房間/);
  assert.match(html, /id="copyRoomBtn"[\s\S]*?複製房號/);
  assert.match(html, /id="backToEntryBtn"[\s\S]*?模式選擇/);
  assert.match(client, /\$\("#copyRoomBtn"\)\.onclick/);
  assert.match(client, /\$\("#backToEntryBtn"\)\.onclick = showEntry/);
});

test("單機與連線都載入同一份 game_engine.js 與共用顯示層", () => {
  for (const [label, page] of [["alpha.html", html], ["index.html", localHtml]]) {
    assert.match(page, /<script src="\/game_engine\.js"><\/script>/, `${label} 缺少 game_engine.js`);
    assert.match(page, /<script src="\/alpha_ui\.js"><\/script>/, `${label} 缺少 alpha_ui.js`);
  }
  for (const route of ["/game_engine.js", "/alpha_ui.js", "/local_client.js"]) {
    assert.ok(server.includes(`["${route}"`), `server 缺少 ${route} 路由`);
  }
});

/* ---------------- 舊引擎已移除 ---------------- */

test("/local 不再含盾 25% 減傷", () => {
  for (const [label, text] of [["index.html", localHtml], ["local_client.js", localClient]]) {
    assert.doesNotMatch(text, /0\.75/, `${label} 仍有 0.75 減傷`);
    assert.doesNotMatch(text, /減傷/, `${label} 仍提到減傷`);
  }
});

test("/local 不再含★★★，全站也不出現", () => {
  for (const [label, text] of [["alpha.html", html], ["alpha_client.js", client],
    ["index.html", localHtml], ["local_client.js", localClient], ["alpha_ui.js", sharedUi]]) {
    assert.doesNotMatch(stripComments(text), /★★★/, `${label} 不應出現 ★★★`);
  }
  assert.match(client, /for \(const \[rank, cost\] of \[\[1, 1\], \[2, 3\]\]\)/);
  assert.match(localClient, /for \(const \[rank, cost\] of \[\[1, 1\], \[2, 3\]\]\)/);
});

test("/local 不再自己實作規則，只呼叫正式引擎", () => {
  assert.match(localClient, /globalThis\.FiveLineEngine/);
  // 不得複製兵種數值表或結算邏輯
  assert.doesNotMatch(localClient, /hp:\s*120|hp:\s*160|atk:\s*24|atk:\s*20/);
  assert.doesNotMatch(localClient, /function resolveCombat|counterBonus|hpMultiplier/);
  assert.doesNotMatch(localHtml, /function resolveCombat|DECK_TEMPLATE|hpMultiplier/);
  // 部署與炮擊都走引擎的公開介面
  assert.match(localClient, /engine\.deploy\(/);
  assert.match(localClient, /engine\.artillery\(/);
});

/* ---------------- 單機拿到的就是 Alpha Core v1 ---------------- */

test("單機★★數值與 GameEngine.unitCatalog() 一致", () => {
  const catalog = GameEngine.unitCatalog();
  assert.equal(catalog.sword.ranks[2].maxHp, 180);
  assert.equal(catalog.shield.ranks[2].maxHp, 240);
  assert.equal(catalog.spear.ranks[2].maxHp, 180);
  for (const type of ["sword", "shield", "spear"]) {
    assert.equal(catalog[type].ranks[2].atk, catalog[type].ranks[1].atk, "★★ ATK 必須是 ★ 的 1 倍");
  }
  assert.equal(catalog.shield.ranks[2].attacks, false);
  // 單機的顯示層讀的就是這份 catalog
  assert.match(localClient, /const catalog = \(\) => GameEngine\.unitCatalog\(\);/);
});

test("單機可實際部署並完成一輪戰鬥（雙方行動後才結算）", () => {
  const engine = fixed();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 1 })).ok, true);
  assert.equal(engine.combatResolutionCount, 0, "第一位部署後不得結算");
  assert.equal(engine.deploy(2, intent(engine, { r: 4, c: 5, type: "shield", rank: 1 })).ok, true);
  assert.equal(engine.combatResolutionCount, 1, "雙方行動後結算一次");
  assert.equal(engine.board[4][4].hp, 95);
  assert.equal(engine.board[4][5].hp, 124);      // 盾無減傷：160 - 36
  assert.equal(engine.roundNo, 2);
});

test("單機流程：★★劍使用正式的斬入規則", () => {
  const engine = bench();
  const sword = engine.put(4, 4, 1, "sword", 2);
  engine.put(4, 5, 2, "spear", 1, 10);
  const behind = engine.put(4, 6, 2, "spear", 1);
  const result = engine.resolveCombat();
  assert.equal(sword.maxHp, 180, "★★劍 HP 為 1.5 倍");
  assert.equal(sword.atk, 24, "★★劍 ATK 為 1 倍");
  assert.equal(engine.board[4][4], null);
  assert.equal(engine.board[4][5].id, sword.id, "強制斬入死亡格");
  assert.equal(result.cleaves[0].followUp.damage, 30, "追擊 24 × 劍剋槍 1.25，不套決鬥");
  assert.equal(behind.hp, 90);
});

test("單機流程：★★盾不主動攻擊並 100% 反震", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const foe = engine.put(4, 5, 2, "spear", 1);
  assert.deepEqual(engine.attackTargets(4, 4, shield), [], "★★盾不主動攻擊");
  const result = engine.resolveCombat();
  assert.equal(shield.maxHp, 240);
  assert.equal(result.damage.find(d => d.unitId === shield.id).damage, 36, "槍剋盾 24 × 1.5");
  assert.equal(shield.hp, 204, "盾沒有額外減傷");
  assert.equal(result.reflections[0].damage, 36, "100% 反震");
  assert.equal(foe.hp, 84);
});

test("單機流程：★★槍穿透且按方向分攤", () => {
  const engine = bench();
  const spear = engine.put(4, 4, 1, "spear", 2);
  const near = engine.put(4, 5, 2, "sword", 1);
  const far = engine.put(4, 6, 2, "sword", 1);
  const side = engine.put(4, 3, 2, "sword", 1);
  const result = engine.resolveCombat();
  const dealt = id => result.packets.find(p => p.from.unitId === spear.id && p.to.unitId === id).amount;
  assert.equal(dealt(near.id), 12, "2 個方向 → 每方向 12");
  assert.equal(dealt(far.id), 6, "第二格 50%，且不增加分母");
  assert.equal(dealt(side.id), 12);
  const total = result.packets.filter(p => p.from.unitId === spear.id).reduce((s, p) => s + p.amount, 0);
  assert.ok(total <= 24 * 1.5 + 1e-9, "pre-counter 總輸出不超過 1.5×ATK");
});

test("單機也受同兵種★★唯一限制，且被擋時仍可出★", () => {
  const engine = fixed();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 2 })).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  engine.players[0].hand = Array(5).fill("sword");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 2 })).ok, false);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 1 })).ok, true);
});

/* ---------------- 說明內容 ---------------- */

test("單機與連線的兵種說明來自同一個共用模組", () => {
  // 文案只定義在 alpha_ui.js，兩個 client 都不得自帶一份
  assert.match(sharedUi, /const ELITE_ABILITY = \{/);
  for (const [label, text] of [["alpha_client.js", client], ["local_client.js", localClient]]) {
    assert.doesNotMatch(text, /const ELITE_ABILITY|const ABILITY = |function rulesHtml/, `${label} 不應自帶文案`);
    assert.match(text, /UI\.renderCardDetail\(/, `${label} 必須使用共用的詳情`);
    assert.match(text, /UI\.wireRulesOverlay\(/, `${label} 必須使用共用的規則視窗`);
    assert.match(text, /UI\.handCardHtml\(/, `${label} 必須使用共用的手牌小卡`);
  }
});

test("主畫面與單機都固定顯示三兵相剋且方向正確", () => {
  for (const [label, page] of [["alpha.html", html], ["index.html", localHtml]]) {
    const hint = page.match(/<span class="pill counterHint"[\s\S]*?<\/span>/);
    assert.ok(hint, `${label} 找不到相剋提示`);
    assert.match(hint[0], /盾[\s\S]*?→[\s\S]*?劍[\s\S]*?→[\s\S]*?槍[\s\S]*?→[\s\S]*?盾/);
    assert.match(hint[0], /title="盾克劍、劍克槍、槍克盾"/);
  }
  const catalog = GameEngine.unitCatalog();
  assert.equal(catalog.shield.counters, "sword");
  assert.equal(catalog.sword.counters, "spear");
  assert.equal(catalog.spear.counters, "shield");
});

test("規則視窗可開可關，且不重置房間或對局", () => {
  for (const page of [html, localHtml]) {
    assert.match(page, /id="rulesOverlay"[^>]*class="overlay hidden"/);
    assert.match(page, /id="helpBtn"[\s\S]*?？ 規則/);
  }
  const wiring = sharedUi.match(/function wireRulesOverlay\(getCatalog\)[\s\S]*?\n  }/)[0];
  assert.doesNotMatch(wiring, /send\(|roomCode\s*=|localStorage|new GameEngine/);
  assert.match(wiring, /classList\.remove\("hidden"\)/);
  assert.match(wiring, /classList\.add\("hidden"\)/);
  assert.match(wiring, /event\.key === "Escape"/);
});

test("規則視窗包含八個必要主題與炮擊說明", () => {
  const rules = sharedUi.match(/function rulesHtml\(catalog\)[\s\S]*?\n  }/)[0];
  for (const topic of ["勝利條件", "回合流程", "兵種相剋", "★ 兵種能力",
    "★★ 菁英能力", "★★ 的限制", "卡片循環", "炮擊"]) {
    assert.match(rules, new RegExp(topic), `規則視窗缺少「${topic}」`);
  }
  assert.match(rules, /3 張同兵種卡/);
  assert.match(rules, /同時最多只能有 1 隻 ★★/);
  assert.match(rules, /3 回合冷卻/);
});

test("勝利流程寫成完整結算後才判定，不是落子即勝", () => {
  const rules = sharedUi.match(/function rulesHtml\(catalog\)[\s\S]*?\n  }/)[0];
  assert.match(rules, /雙方完成本回合行動　→　全場戰鬥結算　→　檢查存活五連/);
  assert.match(rules, /放下第五顆<b>不會<\/b>立刻獲勝/);
});

test("炮擊說明與正式 engine 的實際規則一致", () => {
  const rules = sharedUi.match(/function rulesHtml\(catalog\)[\s\S]*?\n  }/)[0];
  const report = fixed().fullMatchReport().rules;
  assert.equal(report.artilleryPerPlayer, 2);
  assert.deepEqual(report.artilleryDamage, { center: 30, outer: 12, friendlyFire: true });
  assert.match(rules, /2 發/);
  assert.match(rules, /中心 30 點/);
  assert.match(rules, /各 12 點/);
  assert.match(rules, /會誤傷自己的單位/);
});

test("三種★★說明與正式規則一致", () => {
  const elite = sharedUi.match(/const ELITE_ABILITY = \{[\s\S]*?\n  \};/)[0];
  assert.match(elite, /強制移入該敵人的死亡格/);
  assert.match(elite, /HP 最低的敵人/);
  assert.match(elite, /不會再次觸發斬入/);
  assert.match(elite, /不主動攻擊/);
  assert.match(elite, /保留 50% 護衛/);
  assert.match(elite, /實際被扣掉多少 HP，就對傷害來源造成等量的反震傷害/);
  assert.match(elite, /穿過第一格的單位攻擊第二格，射程仍然只有 2 格/);
  assert.match(elite, /第二格的敵人受到 50%/);
  assert.match(elite, /友軍不受傷/);
});

test("★★盾在小卡與詳情都標示為不主動攻擊", () => {
  assert.match(sharedUi, /ranks\[2\]\.attacks \? String\(ranks\[2\]\.atk\) : "—"/);
  assert.match(sharedUi, /"—（不主動攻擊）"/);
});

test("手牌小卡顯示兵種、星級、HP、ATK 與簡短能力標籤", () => {
  assert.match(sharedUi, /★ HP\$\{catalog\[type\]\.ranks\[1\]\.maxHp\}／攻/);
  assert.match(sharedUi, /★★ HP\$\{catalog\[type\]\.ranks\[2\]\.maxHp\}／攻/);
  assert.match(sharedUi, /const SHORT_TAG = \{ sword: "決鬥", shield: "護衛", spear: "遠射" \}/);
  assert.match(sharedUi, /const ELITE_TAG = \{ sword: "斬入", shield: "反震", spear: "穿透" \}/);
});

test("卡牌詳情不破壞原本的選牌與部署流程", () => {
  for (const [label, text] of [["alpha_client.js", client], ["local_client.js", localClient]]) {
    assert.match(text, /button\.onclick = \(\) => \{ selectedType = type; selectedRank = 1; artilleryMode = false; render\(\); \};/,
      `${label} 的點擊必須維持只做選牌`);
    const hover = text.match(/button\.addEventListener\("mouseenter".*/)[0];
    assert.doesNotMatch(hover, /selectedType/, `${label} 的 hover 不得改變已選卡`);
  }
  for (const page of [html, localHtml]) {
    assert.match(page, /<div id="cardDetail" class="cardDetail idle"><\/div>/, "詳情卡初始必須是隱藏且無內容");
  }
});

test("版面不得跳動：會變動內容的區塊都有固定尺寸或不佔版面", () => {
  // name 形如 ".cardDetail"；取出該 selector 的整段宣告
  const rule = name => {
    const match = css.match(new RegExp("\\" + name + "\\s*\\{[^}]*\\}"));
    assert.ok(match, `alpha_board.css 找不到 ${name} 的樣式`);
    return match[0];
  };

  // 1. 詳情大卡必須完全不參與版面流，出現與消失都不推擠棋盤
  const detail = rule(".cardDetail");
  assert.match(detail, /position:\s*absolute/, "詳情卡必須 absolute，才不會撐開手牌區");
  assert.match(detail, /width:\s*\d+px/, "詳情卡寬度必須固定");
  assert.match(detail, /height:\s*\d+px/, "詳情卡高度必須固定，內容多寡不得改變尺寸");
  assert.match(detail, /overflow:\s*auto/, "內容超出時應內部捲動而非撐高");
  assert.match(css, /\.cardDetail\.idle\s*\{\s*display:\s*none/, "沒有目標時必須整張隱藏");

  // 2. 星級選擇列永遠佔位；選牌前後高度不變
  assert.match(rule(".rankRow"), /min-height:\s*\d+px/, "星級列必須預留固定高度");

  // 3. 手牌小卡尺寸固定，不同兵種不得造成列高變化
  const card = rule(".card");
  assert.match(card, /width:\s*\d+px/);
  assert.match(card, /height:\s*\d+px/);

  // 4. 定位基準存在，且不得裁切浮出的大卡
  for (const [label, page] of [["alpha.html", html], ["index.html", localHtml]]) {
    assert.match(page, /class="[^"]*handPanel[^"]*"/, `${label} 需要 handPanel 作為定位基準`);
  }
  assert.match(css, /\.handPanel\s*\{[^}]*position:\s*relative/);
  assert.doesNotMatch(localHtml, /\.handPanel\{[^}]*overflow:\s*hidden/, "handPanel 不得裁切浮出的大卡");

  // 5. 棋盤尺寸不得依賴手牌區高度的魔術數字
  assert.doesNotMatch(localHtml, /calc\(100vh - 230px\)/, "棋盤不應再用寫死的視窗高度推算");
});

test("觸控裝置不依賴 hover：點選手牌即可看到同一份詳情", () => {
  for (const text of [client, localClient]) {
    const start = text.indexOf("function renderHand()");
    const end = text.indexOf("function renderCardDetail()");
    assert.ok(start > 0 && end > start);
    assert.match(text.slice(start, end), /renderCardDetail\(\);/);
    assert.match(text, /hoverType \|\| selectedType/);
  }
});

test("engine 提供權威數值給 UI，前端不自行硬編數值", () => {
  const state = fixed().visibleStateFor(1);
  assert.ok(state.unitCatalog);
  assert.equal(state.unitCatalog.sword.ranks[1].maxHp, 120);
  assert.equal(state.unitCatalog.shield.ranks[2].maxHp, 240);
  assert.equal(state.eliteCardCost, 3);
  assert.equal(state.deathCooldownRounds, 3);
  assert.match(client, /state && state\.unitCatalog/);
});

test("兩個頁面都能真的隱藏 overlay：.hidden 必須來自共用樣式", () => {
  // index.html 沒有自己的 .hidden，只靠 alpha_board.css；少了這條規則
  // 規則視窗會一進頁面就展開而且關不掉。
  assert.match(css, /^\.hidden\s*\{[^}]*display:\s*none/m, "alpha_board.css 必須定義 .hidden");
  for (const [label, page] of [["alpha.html", html], ["index.html", localHtml]]) {
    assert.match(page, /<link rel="stylesheet" href="\/alpha_board\.css">/, `${label} 必須載入共用樣式`);
    assert.match(page, /id="rulesOverlay"[^>]*class="overlay hidden"/, `${label} 的規則視窗預設應為隱藏`);
    assert.match(page, /id="rulesCloseBtn"/, `${label} 缺少關閉按鈕`);
  }
  // 開關確實是靠 .hidden 這個 class
  const wiring = sharedUi.match(/function wireRulesOverlay\(getCatalog\)[\s\S]*?\n  }/)[0];
  assert.match(wiring, /classList\.add\("hidden"\)/);
  assert.match(wiring, /classList\.remove\("hidden"\)/);
});

test("棋盤尺寸由 JS 量容器寫入像素，不依賴脆弱的 CSS 推算", () => {
  // 之前用 aspect-ratio + max-height 會被壓扁、用容器查詢單位會整個塌掉，
  // 改成量容器直接寫像素，並取 9 的倍數讓每格是整數像素。
  assert.match(sharedUi, /function autoSizeBoard\(boardEl, wrapEl\)/);
  assert.match(sharedUi, /Math\.floor\(available \/ 9\) \* 9/, "應取 9 的倍數避免半像素格線");
  assert.match(sharedUi, /boardEl\.style\.width = /);
  assert.match(sharedUi, /boardEl\.style\.height = /);
  assert.match(sharedUi, /return apply;/, "必須回傳 apply 讓 render 每次重算");

  // 兩個 client 都在每次重繪時重新計算，不倚賴 ResizeObserver 的觸發時機
  for (const [label, text] of [["alpha_client.js", client], ["local_client.js", localClient]]) {
    assert.match(text, /const sizeBoard = UI\.autoSizeBoard\(/, `${label} 必須取得 sizeBoard`);
    const start = text.indexOf("function renderBoard()");
    const end = text.indexOf("function renderHand()");
    assert.match(text.slice(start, end), /sizeBoard\(\);/, `${label} 的 renderBoard 必須重算尺寸`);
  }

  // CSS 不得再自己推算棋盤大小
  for (const [label, text] of [["alpha_board.css", css], ["game_shell.css", shellCss]]) {
    const rule = text.match(/\.board\s*\{[^}]*\}/)[0];
    assert.doesNotMatch(rule, /aspect-ratio/, `${label} 的 .board 不應再用 aspect-ratio`);
    assert.doesNotMatch(rule, /cqw|cqh/, `${label} 的 .board 不應再用容器查詢單位`);
    assert.doesNotMatch(rule, /max-height/, `${label} 的 .board 不應再用 max-height`);
  }
});

test("grid 軌道不得被不換行的手牌撐爆版面", () => {
  // 1fr 的隱含最小值是 min-content，會被固定寬度的手牌列撐開，
  // 導致整條版面超出視窗（手機上大卡與面板會跑出畫面）。
  const appRule = shellCss.match(/\.app\s*\{[^}]*\}/)[0];
  assert.match(appRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, ".app 的欄軌必須是 minmax(0,1fr)");
  assert.match(shellCss, /\.gameCol\{[^}]*min-width:0/, ".gameCol 必須可縮");
  assert.doesNotMatch(shellCss, /\.layout\{grid-template-columns:1fr;/, "窄螢幕的 .layout 不得用裸 1fr");
  assert.match(css, /\.hand \{[^}]*overflow-x:\s*auto/, "手牌列必須可水平捲動而不是撐開容器");
  assert.match(css, /\.cardDetail\s*\{[\s\S]*?\}[\s\S]*?max-width:\s*calc\(100vw/, "小螢幕的大卡需以視窗寬度為硬上限");
});

/* ---------------- 這一輪的四項 UX 需求 ---------------- */

test("兵種大卡不得被任何祖先裁切", () => {
  // 大卡是往上浮出手牌面板外的；面板一旦 overflow:hidden 就會被整個切掉，
  // 表現就是「卡片說明不見了」。
  // 先去掉 CSS 註解，否則註解裡提到的字串會被誤判成實際宣告
  const layoutNoComments = layoutCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = layoutNoComments.match(/\.handPanel\s*\{[^}]*\}/g) || [];
  assert.ok(rules.length, "local_layout.css 應定義 .handPanel");
  for (const rule of rules) {
    assert.doesNotMatch(rule, /overflow:\s*hidden/, ".handPanel 不得裁切浮出的大卡");
  }
  assert.match(rules[0], /overflow:\s*visible/, "主要 .handPanel 規則必須明確允許溢出");
  assert.doesNotMatch(shellCss, /\.handPanel\{[^}]*overflow:\s*hidden/);
});

test("單機與連線使用同一組版面樣式與結構", () => {
  for (const [label, page] of [["alpha.html", html], ["index.html", localHtml]]) {
    assert.match(page, /href="\/game_shell\.css"/, `${label} 必須載入共用外殼樣式`);
    assert.match(page, /href="\/local_layout\.css/, `${label} 必須載入共用版面`);
    // 相同的結構槽位
    for (const marker of ['class="top"', 'class="layout"', 'class="gameCol"', 'class="boardWrap"',
      'class="handPanel"', 'class="handHeader"', 'id="hand"', 'id="rankRow"',
      'id="cardDetail"', 'class="side"', 'turnSection', 'previewSection', 'logSection']) {
      assert.ok(page.includes(marker), `${label} 缺少共用結構 ${marker}`);
    }
  }
  for (const route of ["/game_shell.css", "/local_layout.css"]) {
    assert.ok(server.includes(`["${route}"`), `server 缺少 ${route} 路由`);
  }
});

test("兩個模式都有直接前往對方的按鈕", () => {
  // 單機 → 連線
  assert.match(localHtml, /class="btn modeLink" href="\/">🌐 連線對戰/);
  // 連線 → 單機
  assert.match(html, /class="btn modeLink" href="\/local">🎮 單機測試/);
});

test("對局進行中隱藏模式切換與重開，改提供棄賽", () => {
  const resignTag = localHtml.match(/<button[^>]*id="resignBtn"[^>]*>/)[0];
  assert.match(resignTag, /class="[^"]*hidden[^"]*"/, "棄賽鈕預設隱藏");
  assert.match(localClient, /function renderSessionControls\(\)/);
  // 開始判定：盤面上有棋子
  assert.match(localClient, /const started = \(\) => Boolean\(engine\) && engine\.board\.some\(row => row\.some\(Boolean\)\)/);
  // 對局中三顆鈕一起隱藏
  assert.match(localClient, /for \(const id of \["#pveBtn", "#pvpBtn", "#resetBtn"\]\)/);
  assert.match(localClient, /classList\.toggle\("hidden", inGame\)/);
  assert.match(localClient, /resign\.classList\.toggle\("hidden", !inGame\)/);
});

test("棄賽會結束對局且不修改引擎規則", () => {
  assert.match(localClient, /\$\("#resignBtn"\)\.onclick/);
  assert.match(localClient, /const finished = \(\) => Boolean\(resigned\)/);
  // AI 與玩家在棄賽後都不能再行動
  assert.match(localClient, /if \(mode !== "pve" \|\| finished\(\) \|\| engine\.current !== 2\) return;/);
  assert.match(localClient, /const humanTurn = \(\) => engine && !finished\(\)/);
  // 棄賽只改本機顯示狀態，不得動到引擎的勝負欄位
  const handler = localClient.match(/\$\("#resignBtn"\)\.onclick[\s\S]*?\n  \};/)[0];
  assert.doesNotMatch(handler, /engine\.gameOver\s*=|engine\.winner\s*=/, "不得直接改寫引擎狀態");
  // 重開會清掉棄賽狀態
  assert.match(localClient, /aiThinking = false; resigned = null;/);
});
