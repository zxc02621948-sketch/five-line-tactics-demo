// Alpha UX 的靜態檢查：入口、相剋提示、規則視窗、卡牌詳情。
// 不啟動瀏覽器，改為檢查 HTML/JS/CSS 的結構與文案，以及 engine 送出的權威數值。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { GameEngine } = require("../game_engine");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const html = read("alpha.html");
const client = read("alpha_client.js");
const css = read("alpha_board.css");
const localHtml = read("index.html");
const server = read("server.js");

test("主要入口同時提供單機與連線兩個選項", () => {
  assert.match(html, /id="entryOverlay"/);
  assert.match(html, /id="entryOnlineBtn"[^>]*>[\s\S]*?連線對戰/);
  assert.match(html, /id="entryLocalBtn"[^>]*href="\/local"[\s\S]*?單機測試/);
  // server 兩條路由都存在，UI 不需要玩家改網址
  assert.match(server, /\["\/", \["alpha\.html"/);
  assert.match(server, /\["\/local", \["index\.html"/);
});

test("單機頁有回到主畫面的入口，且標示為舊版規則", () => {
  assert.match(localHtml, /href="\/"[^>]*>← 回主畫面／連線對戰/);
  assert.match(localHtml, /本頁是舊版原型/);
});

test("連線對戰有建立房間、複製房號、加入房間、返回模式選擇", () => {
  assert.match(html, /id="createBtn"[\s\S]*?建立房間/);
  assert.match(html, /id="roomInput"/);
  assert.match(html, /id="joinBtn"[\s\S]*?加入房間/);
  assert.match(html, /id="copyRoomBtn"[\s\S]*?複製房號/);
  assert.match(html, /id="backToEntryBtn"[\s\S]*?返回模式選擇/);
  assert.match(client, /\$\("#copyRoomBtn"\)\.onclick/);
  assert.match(client, /\$\("#backToEntryBtn"\)\.onclick = showEntry/);
});

test("主畫面固定顯示三兵相剋且方向正確", () => {
  const hint = html.match(/<span class="pill counterHint"[\s\S]*?<\/span>/);
  assert.ok(hint, "找不到相剋提示");
  assert.match(hint[0], /盾[\s\S]*?→[\s\S]*?劍[\s\S]*?→[\s\S]*?槍[\s\S]*?→[\s\S]*?盾/);
  assert.match(hint[0], /title="盾克劍、劍克槍、槍克盾"/);
  // 與引擎的 COUNTER 表一致
  const catalog = GameEngine.unitCatalog();
  assert.equal(catalog.shield.counters, "sword");
  assert.equal(catalog.sword.counters, "spear");
  assert.equal(catalog.spear.counters, "shield");
});

test("規則視窗可開可關，且不重置房間或對局", () => {
  assert.match(html, /id="rulesOverlay"[^>]*class="overlay hidden"/);
  assert.match(html, /id="helpBtn"[\s\S]*?？ 規則/);
  assert.match(client, /\$\("#rulesCloseBtn"\)\.onclick = closeRules/);
  assert.match(client, /event\.key === "Escape"/);
  // 開關只操作 class，不碰 socket / roomCode / state
  const open = client.match(/function openRules\(\)[\s\S]*?\n  }/)[0];
  const close = client.match(/const closeRules = [^\n]*/)[0];
  for (const fragment of [open, close]) {
    assert.doesNotMatch(fragment, /send\(|roomCode\s*=|state\s*=|localStorage/);
  }
});

test("規則視窗包含八個必要主題與炮擊說明", () => {
  const rules = client.match(/function rulesHtml\(\)[\s\S]*?\n  }/)[0];
  for (const topic of ["勝利條件", "回合流程", "兵種相剋", "★ 兵種能力",
    "★★ 菁英能力", "★★ 的限制", "卡片循環", "炮擊"]) {
    assert.match(rules, new RegExp(topic), `規則視窗缺少「${topic}」`);
  }
  assert.match(rules, /3 張同兵種卡/);
  assert.match(rules, /同時最多只能有 1 隻 ★★/);
  assert.match(rules, /3 回合冷卻/);
});

test("勝利流程寫成完整結算後才判定，不是落子即勝", () => {
  const rules = client.match(/function rulesHtml\(\)[\s\S]*?\n  }/)[0];
  assert.match(rules, /雙方完成本回合行動　→　全場戰鬥結算　→　檢查存活五連/);
  assert.match(rules, /放下第五顆<b>不會<\/b>立刻獲勝/);
});

test("炮擊說明與正式 engine 的實際規則一致", () => {
  const rules = client.match(/function rulesHtml\(\)[\s\S]*?\n  }/)[0];
  const report = new GameEngine({ randomInt: () => 0 }).fullMatchReport().rules;
  assert.equal(report.artilleryPerPlayer, 2);
  assert.deepEqual(report.artilleryDamage, { center: 30, outer: 12, friendlyFire: true });
  assert.match(rules, /2 發/);
  assert.match(rules, /中心 30 點/);
  assert.match(rules, /各 12 點/);
  assert.match(rules, /會誤傷自己的單位/);
});

test("★★★ 不出現在 Alpha 的選擇器或說明中", () => {
  // 只看玩家看得到的字串，忽略程式註解
  const stripComments = text => text.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(stripComments(html), /★★★/);
  assert.doesNotMatch(stripComments(client), /★★★/);
  // 星級選擇器只列出 ★ 與 ★★
  assert.match(client, /for \(const \[rank, cost\] of \[\[1, 1\], \[2, 3\]\]\)/);
});

test("三種★★說明與正式規則一致", () => {
  const elite = client.match(/const ELITE_ABILITY = \{[\s\S]*?\n  \};/)[0];
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
  const catalog = GameEngine.unitCatalog();
  assert.equal(catalog.shield.ranks[2].attacks, false, "engine 必須回報★★盾不攻擊");
  assert.equal(catalog.sword.ranks[2].attacks, true);
  assert.equal(catalog.spear.ranks[2].attacks, true);
  // 小卡：attacks 為 false 時顯示破折號
  assert.match(client, /const twoAtk = two\.attacks \? two\.atk : "—";/);
  // 詳情：另外標明原因
  assert.match(client, /"—（不主動攻擊）"/);
});

test("手牌小卡顯示兵種、星級、HP、ATK 與簡短能力標籤", () => {
  assert.match(client, /★ HP\$\{one\.maxHp\}／攻\$\{one\.atk\}/);
  assert.match(client, /★★ HP\$\{two\.maxHp\}／攻\$\{twoAtk\}/);
  assert.match(client, /const SHORT_TAG = \{ sword: "決鬥", shield: "護衛", spear: "遠射" \}/);
  assert.match(client, /const ELITE_TAG = \{ sword: "斬入", shield: "反震", spear: "穿透" \}/);
});

test("卡牌詳情不破壞原本的選牌與部署流程", () => {
  // 點擊仍然只做選牌
  assert.match(client, /button\.onclick = \(\) => \{ selectedType = type; selectedRank = 1; artilleryMode = false; render\(\); \};/);
  // hover 只更新詳情，不改 selectedType
  const hover = client.match(/button\.addEventListener\("mouseenter"[^\n]*/)[0];
  assert.doesNotMatch(hover, /selectedType/);
  assert.match(hover, /hoverType = type; renderCardDetail\(\)/);
  // 詳情是固定區塊，不是覆蓋棋盤的浮動層
  assert.match(html, /<div id="cardDetail" class="cardDetail">/);
  assert.doesNotMatch(css.match(/\.cardDetail \{[\s\S]*?\}/)[0], /position:\s*(fixed|absolute)/);
});

test("觸控裝置不依賴 hover：點選手牌即可看到同一份詳情", () => {
  const start = client.indexOf("function renderHand()");
  const end = client.indexOf("function renderCardDetail()");
  assert.ok(start > 0 && end > start, "找不到 renderHand / renderCardDetail");
  assert.match(client.slice(start, end), /renderCardDetail\(\);/);
  // 詳情來源為 hover 或已選卡，touch 沒有 hover 時退回已選卡
  assert.match(client, /const type = hoverType \|\| selectedType;/);
});

test("engine 提供權威數值給 UI，前端不自行硬編數值", () => {
  const state = new GameEngine({ randomInt: () => 0 }).visibleStateFor(1);
  assert.ok(state.unitCatalog, "visibleStateFor 必須帶出 unitCatalog");
  assert.equal(state.unitCatalog.sword.ranks[1].maxHp, 120);
  assert.equal(state.unitCatalog.shield.ranks[2].maxHp, 240);
  assert.equal(state.eliteCardCost, 3);
  assert.equal(state.deathCooldownRounds, 3);
  assert.match(client, /const catalog = \(\) => \(state && state\.unitCatalog\) \|\| null;/);
});
