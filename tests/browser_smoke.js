// Real browser coverage for the shared renderer, tutorial, AI worker/fallback and narrow layouts.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('playwright')); }
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'five-line-smoke-'));
process.env.MATCH_LOG_DIR = logDir;
const { server, wss } = require('../server');
const errors = [], badResponses = [], completed = [];
function track(page, label) {
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${label}: ${response.status()} ${response.url()}`); });
  page.setDefaultTimeout(8000);
  return page;
}
async function imagesLoaded(page, selector) {
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].length > 0
    && [...document.querySelectorAll(selector)].every(img => img.complete && img.naturalWidth > 0), selector);
}
async function layout(page) {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.viewport + 1, `horizontal overflow: ${JSON.stringify(size)}`);
  const board = await page.locator('#board').boundingBox();
  assert.ok(board && board.width > 200 && Math.abs(board.width - board.height) <= 2, `square board: ${JSON.stringify(board)}`);
}
async function deploy(page, index) {
  await page.locator('#hand .card:not(:disabled)').first().click();
  await page.locator('#board .cell').nth(index).click();
  await page.locator('#confirmActionBtn:not(:disabled)').click();
  await page.locator(`#board .cell:nth-child(${index + 1}) .unit:not(.draftGhost)`).waitFor();
}
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const executablePath = [process.env.CHROME_PATH,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      chromium.executablePath()].find(candidate => candidate && fs.existsSync(candidate));
    if (!executablePath) throw new Error('Set CHROME_PATH to an installed Chromium/Chrome/Edge executable');
    browser = await chromium.launch({ headless: true, executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = track(await browser.newPage({ viewport: { width: 1440, height: 1000 } }), 'desktop');
    await page.goto(`${base}/local`);
    await imagesLoaded(page, '#hand img'); await layout(page);
    await page.locator('#helpBtn').click();
    await page.locator('#rulesOverlay:not(.hidden)').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#rulesOverlay.hidden').waitFor({ state: 'attached' });
    await page.locator('#hand .card').first().click();
    await page.locator('#board .cell').nth(40).click();
    assert.equal(await page.locator('#board .unit:not(.draftGhost)').count(), 0, 'preview must not deploy');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#board .draftGhost').count(), 0, 'Escape clears preview');
    await deploy(page, 40);
    assert.equal(await page.locator('#endTurnBtn').isEnabled(), true);
    assert.equal(await page.locator('#artilleryBtn').isEnabled(), true, 'artillery remains available after deployment');
    await page.locator('#artilleryBtn').click();
    await page.locator('#board .cell').nth(0).click();
    assert.ok(await page.locator('#forecastLayer .artCell').count() > 0);
    await page.locator('#cancelActionBtn').click();
    assert.equal(await page.locator('#forecastLayer .artCell').count(), 0);
    assert.equal(await page.locator('#board .unit:not(.draftGhost)').count(), 1);
    await page.locator('#endTurnBtn').click();
    await page.waitForFunction(() => document.querySelector('#roundText').textContent.includes('2')
      && !document.querySelector('#hand .card')?.disabled);
    assert.ok(await page.locator('#board .unit.p2').count() > 0, 'worker AI must deploy');
    completed.push('desktop preview/cancel, post-deployment artillery, AI worker turn');

    // Start another AI job and reset immediately; a cancelled job must not modify the new match.
    const empty = await page.locator('#board .cell').evaluateAll(cells => cells.findIndex(cell => !cell.querySelector('.unit')));
    await deploy(page, empty); await page.locator('#endTurnBtn').click();
    await page.locator('#matchMenu > summary').click(); await page.locator('#resetBtn').click();
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#board .unit:not(.draftGhost)').count(), 0, 'stale AI must not act after reset');
    completed.push('AI cancellation on reset');

    const fallback = track(await browser.newPage(), 'fallback');
    await fallback.addInitScript(() => { globalThis.Worker = undefined; });
    await fallback.goto(`${base}/local`); await deploy(fallback, 40);
    await fallback.locator('#endTurnBtn').click();
    await fallback.waitForFunction(() => document.querySelector('#roundText').textContent.includes('2')
      && !document.querySelector('#hand .card')?.disabled);
    assert.ok(await fallback.locator('#board .unit.p2').count() > 0);
    completed.push('AI fallback without Worker'); await fallback.close();

    await page.goto(`${base}/learn`);
    for (const type of ['sword', 'shield', 'spear']) for (const rank of [1, 2]) {
      await page.locator(`#typeChoices [data-type="${type}"]`).click();
      await page.locator(`#rankChoices [data-rank="${rank}"]`).click();
      await imagesLoaded(page, '#unitDetail img');
      assert.match(await page.locator('#unitDetail img').getAttribute('src'), new RegExp(`${rank === 2 ? 'elite-' : ''}${type}-v1\\.png$`));
    }
    await page.locator('#nextStep').click();
    await page.locator('.practiceCell').nth(40).click();
    await page.locator('#confirmPractice').click();
    assert.match(await page.locator('#practiceStatus').innerText(), /已在 E5 確認部署/);
    await page.locator('#nextStep').click();
    await page.locator('.practiceCell').nth(40).click();
    assert.match(await page.locator('#practiceStatus').innerText(), /會傷及友軍/);
    await page.locator('#confirmPractice').click(); await page.locator('#nextStep').click();
    await page.locator('#endTurnPractice').click(); await page.locator('#nextStep').click();
    assert.match(await page.locator('#completionText').innerText(), /3\/3/);
    completed.push('all six portraits and complete five-step tutorial');

    for (const width of [320, 390, 760]) {
      const mobile = track(await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true }), `mobile ${width}`);
      await mobile.goto(`${base}/local`); await layout(mobile);
      await mobile.locator('#hand .card').first().click();
      await mobile.locator('#unitDetailBtn').click(); await mobile.locator('#unitDialog[open]').waitFor();
      await imagesLoaded(mobile, '#unitDialog img');
      await mobile.locator('#unitDialogClose').click();
      await mobile.locator('#board .cell').nth(40).click();
      await mobile.locator('#confirmActionBtn:not(:disabled)').click();
      await mobile.locator('#board .cell').nth(40).locator('.unit:not(.draftGhost)').waitFor();
      await layout(mobile);
      const rankOverflow = await mobile.locator('#rankRow .btn').evaluateAll(buttons => buttons.some(button => {
        const box = button.getBoundingClientRect();
        return [...button.children].some(child => child.getBoundingClientRect().bottom > box.bottom);
      }));
      assert.equal(rankOverflow, false, 'disabled rank explanations must fit narrow screens');
      if (process.env.QA_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
        await mobile.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `mobile-${width}.png`), fullPage: true });
      }
      await mobile.close(); completed.push(`mobile ${width}px: layout, details, deployment`);
    }
    assert.deepEqual(errors, [], 'uncaught browser errors');
    assert.deepEqual(badResponses, [], 'failed HTTP resources');
    console.log(JSON.stringify({ ok: true, completed, browserErrors: errors.length, failedResources: badResponses.length }, null, 2));
  } finally {
    if (browser) await browser.close();
    for (const socket of wss.clients) socket.terminate();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(logDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
