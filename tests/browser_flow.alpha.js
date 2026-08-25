const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let chromium;
try { ({ chromium } = require("playwright-core")); }
catch {
  try { ({ chromium } = require("playwright")); }
  catch { throw new Error("瀏覽器流程測試需要 playwright-core：npm install --no-save playwright-core"); }
}
const { baseStats } = require("../game_engine");

async function waitUntil(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for server state");
}

function installNearWinFixture(game) {
  game.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  const stats = baseStats("sword", 1);
  for (let c = 0; c < 4; c++) {
    game.board[0][c] = {
      id: c + 1, pid: 1, type: "sword", rank: 1, cards: 1,
      hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk,
    };
  }
  game.nextUnitId = 5;
  game.players[0].hand = ["sword", "shield", "shield", "spear", "spear"];
  game.players[0].deck = [
    ...Array(4).fill("sword"), ...Array(7).fill("shield"), ...Array(5).fill("spear"),
  ];
  game.players[0].cooldown = [];
  game.players[1].hand = ["shield", "sword", "sword", "spear", "spear"];
  game.players[1].deck = [
    ...Array(7).fill("sword"), ...Array(8).fill("shield"), ...Array(5).fill("spear"),
  ];
  game.players[1].cooldown = [];
  assert.equal(game.cardDistribution(1).valid, true);
  assert.equal(game.cardDistribution(2).valid, true);
}

(async () => {
  const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "five-line-browser-alpha-"));
  process.env.MATCH_LOG_DIR = tempLogDir;
  const { server, wss, rooms } = require("../server");
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const alphaPath = process.env.ALPHA_PATH || "/";
    const browserExecutable = [
      process.env.CHROME_PATH,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      chromium.executablePath(),
    ].find(candidate => candidate && fs.existsSync(candidate));
    if (!browserExecutable) throw new Error("No Chromium/Chrome/Edge executable found for browser Alpha test");
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const p1Context = await browser.newContext();
    const p2Context = await browser.newContext();
    const p1Page = await p1Context.newPage();
    const p2Page = await p2Context.newPage();
    const pageErrors = [];
    p1Page.on("pageerror", error => pageErrors.push(`P1: ${error.message}`));
    p2Page.on("pageerror", error => pageErrors.push(`P2: ${error.message}`));

    await Promise.all([
      p1Page.goto(`http://127.0.0.1:${port}${alphaPath}`),
      p2Page.goto(`http://127.0.0.1:${port}${alphaPath}`),
    ]);
    await Promise.all([
      p1Page.locator("#entryOnlineBtn").click(),
      p2Page.locator("#entryOnlineBtn").click(),
    ]);
    await Promise.all([
      p1Page.locator("#createBtn:not([disabled])").waitFor(),
      p2Page.locator("#joinBtn:not([disabled])").waitFor(),
    ]);

    await p1Page.locator("#createBtn").click();
    await p1Page.locator("#roomIdentity").waitFor({ state: "visible" });
    const identity = await p1Page.locator("#roomIdentity").textContent();
    const code = identity.match(/[A-Z2-9]{6}/)[0];
    await p2Page.locator("#roomInput").fill(code);
    await p2Page.locator("#joinBtn").click();
    await waitUntil(() => rooms.get(code)?.game);

    const room = rooms.get(code);
    assert.equal(room.mode, "fixed", "正式瀏覽器入口必須使用固定 P1 → P2 順序");
    installNearWinFixture(room.game);

    // 重新整理會走正式重連流程，並讓兩端取得測試局面的權威狀態。
    await Promise.all([p1Page.reload(), p2Page.reload()]);
    await Promise.all([
      p1Page.locator("#board .unit").nth(3).waitFor(),
      p2Page.locator("#board .unit").nth(3).waitFor(),
    ]);
    await waitUntil(() => rooms.get(code)?.players[1]?.connected && rooms.get(code)?.players[2]?.connected);
    assert.equal(await p1Page.locator("#privacyInfo").evaluate(node => node.classList.contains("hidden")), false);
    assert.equal(await p2Page.locator("#privacyInfo").evaluate(node => node.classList.contains("hidden")), false);

    await p1Page.locator(".card:not([disabled])").first().click();
    await p1Page.locator(".cell").nth(4).click();
    await waitUntil(() => Boolean(room.game.board[0][4]));
    await p2Page.locator(".card:not([disabled])").first().click();
    await p2Page.locator(".cell").nth(80).click();
    await waitUntil(() => room.game.gameOver);

    assert.equal(room.game.winner, 1);
    assert.equal(room.game.endReason, "five_line");
    await Promise.all([
      p1Page.locator("#matchSummarySection:not(.hidden)").waitFor(),
      p2Page.locator("#matchSummarySection:not(.hidden)").waitFor(),
    ]);
    assert.match(await p1Page.locator("#matchSummary").innerText(), /P1 獲勝/);
    assert.match(await p2Page.locator("#matchSummary").innerText(), /P1 獲勝/);
    const p1Board = await p1Page.locator("#board").innerText();
    const p2Board = await p2Page.locator("#board").innerText();
    assert.equal(p1Board, p2Board);
    assert.match(await p1Page.locator("#privacyInfo").innerText(), /對方手牌：\d+ 張（內容隱藏）/);
    assert.match(await p2Page.locator("#privacyInfo").innerText(), /對方手牌：\d+ 張（內容隱藏）/);

    await waitUntil(() => fs.readdirSync(tempLogDir).some(file => file.endsWith(".json")));
    const logFile = fs.readdirSync(tempLogDir).find(file => file.endsWith(".json"));
    const report = JSON.parse(fs.readFileSync(path.join(tempLogDir, logFile), "utf8"));
    assert.equal(report.winner, 1);
    assert.equal(report.endReason, "five_line");
    assert.equal(report.finalRound, 1);
    assert.equal(report.combatResolutionCount, 1);
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    console.log(JSON.stringify({
      ok: true, roomCode: code, winner: report.winner, endReason: report.endReason,
      finalRound: report.finalRound, combatResolutions: report.combatResolutionCount,
      report: logFile,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    for (const socket of wss?.clients || []) socket.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempLogDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
