const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function waitUntil(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for server state");
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
    await p1Page.locator("#createBtn").click();
    await p1Page.locator("#roomIdentity").waitFor({ state: "visible" });
    const identity = await p1Page.locator("#roomIdentity").textContent();
    const code = identity.match(/[A-Z2-9]{6}/)[0];
    await p2Page.locator("#roomInput").fill(code);
    await p2Page.locator("#joinBtn").click();
    await waitUntil(() => rooms.get(code)?.game);
    await Promise.all([
      p1Page.locator("#turnText").filter({ hasText: "第 1 輪" }).waitFor(),
      p2Page.locator("#turnText").filter({ hasText: "第 1 輪" }).waitFor(),
    ]);

    const pages = { 1: p1Page, 2: p2Page };
    const cells = { 1: [0, 1, 2, 3, 4], 2: [72, 73, 74, 75, 76] };
    const placed = { 1: 0, 2: 0 };
    const room = rooms.get(code);
    assert.equal(room.mode, alphaPath.includes("fixed") ? "fixed" : "alternating");
    while (!room.game.gameOver) {
      const pid = room.game.current;
      const cellIndex = cells[pid][placed[pid]++];
      assert.notEqual(cellIndex, undefined, "Expected the five-row browser flow to finish within five deployments each");
      const page = pages[pid];
      await page.locator(".card:not([disabled])").first().click();
      await page.locator(".cell").nth(cellIndex).click();
      const r = Math.floor(cellIndex / 9), c = cellIndex % 9;
      await waitUntil(() => Boolean(room.game.board[r][c]) || room.game.gameOver);
    }

    assert.equal(room.game.winner, "draw");
    await Promise.all([
      p1Page.locator("#matchSummarySection:not(.hidden)").waitFor(),
      p2Page.locator("#matchSummarySection:not(.hidden)").waitFor(),
    ]);
    const p1Board = await p1Page.locator("#board").innerText();
    const p2Board = await p2Page.locator("#board").innerText();
    assert.equal(p1Board, p2Board);
    assert.match(await p1Page.locator("#privacyInfo").innerText(), /對方手牌：\d+ 張（內容隱藏）/);
    assert.match(await p2Page.locator("#privacyInfo").innerText(), /對方手牌：\d+ 張（內容隱藏）/);
    await waitUntil(() => fs.readdirSync(tempLogDir).some(file => file.endsWith(".json")));
    const logFile = fs.readdirSync(tempLogDir).find(file => file.endsWith(".json"));
    const report = JSON.parse(fs.readFileSync(path.join(tempLogDir, logFile), "utf8"));
    assert.equal(report.winner, "draw");
    assert.equal(report.finalRound, 5);
    assert.equal(report.combatResolutionCount, 5);
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    console.log(JSON.stringify({ ok: true, roomCode: code, winner: report.winner, finalRound: report.finalRound, combatResolutions: report.combatResolutionCount, report: logFile }, null, 2));
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
