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
  const put = (r, c, pid, type, rank, hp) => {
    const stats = baseStats(type, rank);
    game.board[r][c] = { id: game.nextUnitId++, pid, type, rank, cards: rank === 2 ? 3 : 1,
      hp: hp ?? stats.maxHp, maxHp: stats.maxHp, atk: stats.atk };
  };
  put(4, 4, 1, "shield", 2);
  put(4, 5, 2, "spear", 1, 20); // 反震擊殺
  put(6, 4, 1, "sword", 2);
  put(6, 5, 2, "sword", 1, 10); // 主攻擊親自致死，觸發斬入
  put(6, 6, 2, "spear", 1, 20); // 斬入後追擊

  game.players[0].hand = ["sword", "shield", "shield", "spear", "spear"];
  game.players[0].deck = [
    ...Array(1).fill("sword"), ...Array(4).fill("shield"), ...Array(5).fill("spear"),
  ];
  game.players[0].cooldown = [];
  game.players[1].hand = ["shield", "sword", "sword", "spear", "spear"];
  game.players[1].deck = [
    ...Array(6).fill("sword"), ...Array(8).fill("shield"), ...Array(3).fill("spear"),
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
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
      p1Page.locator("#createBtn:not([disabled])").waitFor(),
      p2Page.locator("#joinBtn:not([disabled])").waitFor(),
    ]);

    await p1Page.locator("#nicknameInput").fill("房主");
    await p1Page.locator("#roomNameInput").fill("測試戰局");
    await p1Page.locator("#roomPasswordInput").fill("browser-secret");
    await p1Page.locator("#createBtn").click();
    await p1Page.locator("#roomIdentity").waitFor({ state: "visible" });
    const identity = await p1Page.locator("#roomIdentity").textContent();
    const code = identity.match(/[A-Z2-9]{6}/)[0];
    await p2Page.locator("#roomInput").fill(code);
    await p2Page.locator("#joinBtn").click();
    await p2Page.locator("#passwordOverlay:not(.hidden)").waitFor();
    await p2Page.locator("#joinPasswordInput").fill("wrong-password");
    await p2Page.locator("#confirmPasswordBtn").click();
    await p2Page.waitForFunction(() => document.querySelector("#passwordError").textContent.includes("密碼錯誤"));
    assert.equal(rooms.get(code).players[2], null, "錯誤密碼不得占座");
    await p2Page.locator("#joinPasswordInput").fill("browser-secret");
    await p2Page.locator("#confirmPasswordBtn").click();
    await waitUntil(() => rooms.get(code)?.game);

    // 等兩端收到 session 並完成入局，避免在 P2 保存重連 token 前重新整理。
    await Promise.all([
      p1Page.locator("#gameScreen:not(.hidden)").waitFor(),
      p2Page.locator("#gameScreen:not(.hidden)").waitFor(),
    ]);
    const room = rooms.get(code);
    assert.equal(room.mode, "fixed", "正式瀏覽器入口必須使用固定 P1 → P2 順序");
    installNearWinFixture(room.game);

    // 重新整理會走正式重連流程，並讓兩端取得測試局面的權威狀態。
    await Promise.all([p1Page.reload(), p2Page.reload()]);
    await Promise.all([
      p1Page.locator("#board .unit").nth(3).waitFor(),
      p2Page.locator("#board .unit").nth(3).waitFor(),
    ]).catch(async error => {
      console.error("PAGE_ERRORS", pageErrors, "BODY", await p1Page.locator("body").innerText());
      await p1Page.screenshot({ path: path.join(os.tmpdir(), "five-line-browser-failure.png"), fullPage: true });
      throw error;
    });
    await waitUntil(() => rooms.get(code)?.players[1]?.connected && rooms.get(code)?.players[2]?.connected);

    await p1Page.locator(".card:not([disabled])").first().click();
    await p1Page.locator(".cell").nth(4).click();
    await p1Page.locator("#confirmActionBtn").click();
    await waitUntil(() => Boolean(room.game.board[0][4]));
    await p1Page.locator("#endTurnBtn:not([disabled])").click();
    await waitUntil(() => room.game.current === 2);
    await p2Page.locator(".card:not([disabled])").first().click();
    await p2Page.locator(".cell").nth(80).click();
    await p2Page.locator("#confirmActionBtn").click();
    await p2Page.locator("#endTurnBtn:not([disabled])").click();
    await waitUntil(() => room.game.gameOver);

    assert.equal(room.game.winner, 1);
    assert.equal(room.game.endReason, "five_line");
    const cue = room.game.lastCombatPresentation();
    assert.ok(cue.cleaves.length > 0, "應包含斬入演出");
    assert.ok(cue.reflections.length > 0, "應包含反震演出");
    await p1Page.locator("#combatStage:not(.hidden)").waitFor();
    assert.equal(await p1Page.locator("#resultOverlay").isVisible(), false, "演出結束前不得蓋上結果");
    await p1Page.locator("#skipCombatBtn").click();
    await Promise.all([
      p1Page.locator("#resultOverlay:not(.hidden)").waitFor(),
      p2Page.locator("#resultOverlay:not(.hidden)").waitFor(),
    ]);
    assert.match(await p1Page.locator("#resultTitle").innerText(), /P1 獲勝/);
    assert.match(await p2Page.locator("#resultTitle").innerText(), /P1 獲勝/);
    const p1Board = await p1Page.locator("#board").innerText();
    const p2Board = await p2Page.locator("#board").innerText();
    assert.equal(p1Board, p2Board);
    assert.equal(await p1Page.locator("#opponentHandCount").innerText(), String(room.game.players[1].hand.length));
    assert.equal(await p2Page.locator("#opponentHandCount").innerText(), String(room.game.players[0].hand.length));
    assert.equal(await p1Page.locator("#opponentBand .card").count(), 0);
    assert.equal(await p2Page.locator("#opponentBand .card").count(), 0);

    await waitUntil(() => fs.readdirSync(tempLogDir).some(file => file.endsWith(".json")));
    const logFile = fs.readdirSync(tempLogDir).find(file => file.endsWith(".json"));
    const report = JSON.parse(fs.readFileSync(path.join(tempLogDir, logFile), "utf8"));
    assert.equal(report.winner, 1);
    assert.equal(report.endReason, "five_line");
    assert.equal(report.finalRound, 1);
    assert.equal(report.combatResolutionCount, 1);
    assert.equal(await p1Page.locator(".cell.final-five-p1").count(), 5);
    assert.equal(await p2Page.locator(".cell.final-five-p1").count(), 5);
    const oldMatchId = room.game.matchId;
    await p1Page.locator("#resultRematchBtn").click();
    await waitUntil(() => room.players[1].rematchWanted);
    assert.equal(room.game.matchId, oldMatchId, "單方確認不應重開");
    await p2Page.locator("#resultRematchBtn").click();
    await waitUntil(() => room.game.matchId !== oldMatchId);
    await Promise.all([
      p1Page.locator("#resultOverlay.hidden").waitFor({ state: "attached" }),
      p2Page.locator("#resultOverlay.hidden").waitFor({ state: "attached" }),
    ]);
    assert.equal(await p1Page.locator("#board .unit").count(), 0);
    assert.equal(await p2Page.locator("#board .unit").count(), 0);
    assert.equal(room.game.gameOver, false);
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    console.log(JSON.stringify({
      ok: true, roomCode: code, winner: report.winner, endReason: report.endReason,
      finalRound: report.finalRound, combatResolutions: report.combatResolutionCount,
      report: logFile, passwordProtection: true, synchronizedRematch: true,
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
