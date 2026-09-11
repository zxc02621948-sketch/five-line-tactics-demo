const CACHE='five-line-demo-v5';
const ASSETS=['./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});

// ---- 單機與連線共用的操作回饋層 ----
// 當 sw.js 作為 Service Worker 載入時，AlphaUI / FiveLineEngine 不存在，這段會直接返回；
// 當頁面把同一檔案當普通 script 載入時，才啟用部署／移動／炮擊演出與音效。
(() => {
  if (globalThis.__fiveLineActionFeedback) return;
  globalThis.__fiveLineActionFeedback = true;

  const UI = globalThis.AlphaUI;
  const Engine = globalThis.FiveLineEngine?.GameEngine;
  if (!UI || !Engine) return;

  const SOUND_KEY = "five-line-sound-enabled";
  const prefersReducedMotion = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let soundEnabled = localStorage.getItem(SOUND_KEY) !== "off";
  let audioContext = null;
  let queue = Promise.resolve();
  let seen = new Set();
  let initialized = false;
  let scheduled = false;

  const board = () => document.querySelector("#board");
  const wrap = () => document.querySelector(".boardWrap");
  const log = () => document.querySelector("#log");
  const combatActive = () => {
    const stage = document.querySelector("#combatStage");
    return Boolean(stage && !stage.classList.contains("hidden"));
  };

  const style = document.createElement("style");
  style.textContent = `
    .actionFxLayer{position:absolute;z-index:7;pointer-events:none;overflow:visible}
    .actionFxCell{position:absolute;box-sizing:border-box}
    .actionDeployRing{border:2px solid rgba(227,193,101,.95);border-radius:50%;box-shadow:0 0 18px rgba(227,193,101,.5);animation:actionDeployRing .38s ease-out forwards}
    .actionDeployDust{position:absolute;width:6px;height:6px;border-radius:50%;background:rgba(214,184,122,.85);box-shadow:0 0 8px rgba(214,184,122,.55);animation:actionDust .42s ease-out forwards}
    .actionDeployUnit{animation:actionDeployUnit .34s cubic-bezier(.18,.82,.24,1)}
    .actionMoveGhost{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:20%;font-weight:1000;color:#f5e7bf;background:linear-gradient(145deg,#57452d,#29251e);border:2px solid #a88b54;box-shadow:0 8px 18px rgba(0,0,0,.45);transform-origin:center;will-change:transform,opacity}
    .actionMoveGhost.p1{box-shadow:inset 0 0 0 3px rgba(206,78,74,.55),0 8px 18px rgba(0,0,0,.45)}
    .actionMoveGhost.p2{box-shadow:inset 0 0 0 3px rgba(73,134,190,.58),0 8px 18px rgba(0,0,0,.45)}
    .actionMoveTrail{position:absolute;height:4px;border-radius:999px;background:linear-gradient(90deg,rgba(227,193,101,.08),rgba(227,193,101,.8),rgba(255,243,190,.12));transform-origin:left center;filter:drop-shadow(0 0 5px rgba(227,193,101,.55));animation:actionTrail .34s ease-out forwards}
    .actionBlastTile{position:absolute;border-radius:16%;background:radial-gradient(circle,rgba(255,248,199,.98) 0 8%,rgba(255,174,66,.85) 22%,rgba(181,62,31,.42) 52%,rgba(65,28,18,0) 76%);mix-blend-mode:screen;animation:actionBlast .56s ease-out forwards}
    .actionBlastTile.outer{opacity:.82;transform:scale(.75)}
    .actionBlastCore{position:absolute;border:3px solid rgba(255,214,113,.95);border-radius:50%;box-shadow:0 0 26px rgba(255,131,54,.8),inset 0 0 18px rgba(255,226,145,.65);animation:actionShock .62s ease-out forwards}
    .actionBlastLabel{position:absolute;transform:translate(-50%,-50%);padding:3px 7px;border:1px solid rgba(255,222,147,.75);border-radius:999px;background:rgba(54,21,13,.86);color:#ffe8b3;font-size:10px;font-weight:1000;white-space:nowrap;animation:actionLabel .7s ease-out forwards}
    .actionSpark{position:absolute;width:5px;height:5px;border-radius:50%;background:#ffd66e;box-shadow:0 0 9px #ff8b3d;animation:actionSpark .58s ease-out forwards}
    .actionBoardShake{animation:actionBoardShake .3s ease-out}
    .soundToggleBtn{white-space:nowrap}
    @keyframes actionDeployRing{0%{opacity:0;transform:scale(.35)}35%{opacity:1}100%{opacity:0;transform:scale(1.45)}}
    @keyframes actionDeployUnit{0%{transform:scale(.58);filter:brightness(1.8)}55%{transform:scale(1.13)}100%{transform:scale(1);filter:none}}
    @keyframes actionDust{0%{opacity:0;transform:translate(0,0) scale(.4)}25%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1.25)}}
    @keyframes actionTrail{0%{opacity:0;transform:scaleX(.12)}35%{opacity:1}100%{opacity:0;transform:scaleX(1)}}
    @keyframes actionBlast{0%{opacity:0;transform:scale(.18)}22%{opacity:1;transform:scale(1.16)}100%{opacity:0;transform:scale(1.5)}}
    @keyframes actionShock{0%{opacity:0;transform:scale(.22)}25%{opacity:1}100%{opacity:0;transform:scale(2.15)}}
    @keyframes actionLabel{0%{opacity:0;transform:translate(-50%,-10%) scale(.8)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-120%) scale(1)}}
    @keyframes actionSpark{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}20%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(.15)}}
    @keyframes actionBoardShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-3px,1px)}40%{transform:translate(3px,-2px)}60%{transform:translate(-2px,2px)}80%{transform:translate(2px,-1px)}}
    @media(prefers-reduced-motion:reduce){
      .actionDeployRing,.actionDeployDust,.actionDeployUnit,.actionMoveTrail,.actionBlastTile,.actionBlastCore,.actionBlastLabel,.actionSpark,.actionBoardShake{animation-duration:.12s!important}
    }
  `;
  document.head.appendChild(style);

  function ensureLayer() {
    const boardEl = board(), wrapEl = wrap();
    if (!boardEl || !wrapEl) return null;
    let layer = wrapEl.querySelector(".actionFxLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "actionFxLayer";
      layer.setAttribute("aria-hidden", "true");
      wrapEl.appendChild(layer);
    }
    const br = boardEl.getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    layer.style.left = `${br.left - wr.left + boardEl.clientLeft}px`;
    layer.style.top = `${br.top - wr.top + boardEl.clientTop}px`;
    layer.style.width = `${boardEl.clientWidth}px`;
    layer.style.height = `${boardEl.clientHeight}px`;
    return layer;
  }

  function cellRect(r, c) {
    const boardEl = board();
    if (!boardEl || !boardEl.clientWidth) return null;
    const size = boardEl.clientWidth / 9;
    return { x: c * size, y: r * size, size };
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function unlockAudio() {
    if (!soundEnabled) return;
    try {
      if (!audioContext) {
        const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctx) return;
        audioContext = new Ctx();
      }
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch {}
  }

  function tone({ start = 160, end = 90, duration = .12, gain = .05, type = "sine" } = {}) {
    if (!soundEnabled) return;
    unlockAudio();
    if (!audioContext || audioContext.state === "suspended") return;
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const amp = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    amp.gain.setValueAtTime(.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + .01);
    amp.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(amp).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + duration + .02);
  }

  function noise(duration = .22, gain = .07) {
    if (!soundEnabled) return;
    unlockAudio();
    if (!audioContext || audioContext.state === "suspended") return;
    const frames = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, frames, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const fade = 1 - i / frames;
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const src = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const amp = audioContext.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 1050;
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(filter).connect(amp).connect(audioContext.destination);
    src.start();
  }

  function playSound(kind) {
    if (kind === "deploy") {
      tone({ start: 115, end: 62, duration: .14, gain: .05, type: "triangle" });
    } else if (kind === "move") {
      tone({ start: 240, end: 135, duration: .1, gain: .035, type: "triangle" });
    } else if (kind === "artillery") {
      tone({ start: 78, end: 32, duration: .34, gain: .085, type: "sine" });
      noise(.28, .075);
    } else if (kind === "toggle") {
      tone({ start: 420, end: 520, duration: .07, gain: .025, type: "sine" });
    }
  }

  function addSoundToggle() {
    const panel = document.querySelector(".matchMenuPanel");
    if (!panel || panel.querySelector(".soundToggleBtn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn soundToggleBtn";
    const sync = () => {
      button.textContent = `音效：${soundEnabled ? "開" : "關"}`;
      button.setAttribute("aria-pressed", String(soundEnabled));
      button.title = soundEnabled ? "關閉操作音效" : "開啟操作音效";
    };
    button.addEventListener("click", event => {
      event.preventDefault();
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, soundEnabled ? "on" : "off");
      sync();
      if (soundEnabled) {
        unlockAudio();
        playSound("toggle");
      }
    });
    sync();
    const logButton = panel.querySelector("#logDrawerToggle");
    if (logButton?.nextSibling) panel.insertBefore(button, logButton.nextSibling);
    else panel.appendChild(button);
  }

  function parseEvent(text) {
    let m = text.match(/P([12]) 在 \((\d+),(\d+)\) 部署 ([★]+)(劍|盾|槍)/);
    if (m) return { kind: "deploy", pid: Number(m[1]), r: Number(m[2]) - 1, c: Number(m[3]) - 1,
      stars: m[4].length, type: m[5], key: text };

    m = text.match(/P([12]) 手牌用盡，將 ([★]+)(劍|盾|槍) 從 \((\d+),(\d+)\) 移動到 \((\d+),(\d+)\)/);
    if (m) return { kind: "move", pid: Number(m[1]), stars: m[2].length, type: m[3],
      r: Number(m[4]) - 1, c: Number(m[5]) - 1, toR: Number(m[6]) - 1, toC: Number(m[7]) - 1, key: text };

    m = text.match(/P([12]) 炮擊 \((\d+),(\d+)\)/);
    if (m) return { kind: "artillery", pid: Number(m[1]), r: Number(m[2]) - 1, c: Number(m[3]) - 1, key: text };
    return null;
  }

  function currentEvents() {
    const logEl = log();
    if (!logEl) return [];
    return [...logEl.children]
      .map(node => ({ text: node.textContent || "", event: parseEvent(node.textContent || "") }))
      .filter(item => item.event)
      .reverse();
  }

  function boardIsEmpty() {
    return !board()?.querySelector("[data-unit-id]");
  }

  async function playDeploy(event) {
    if (combatActive()) return;
    const layer = ensureLayer();
    const rect = cellRect(event.r, event.c);
    if (!layer || !rect) return;
    playSound("deploy");

    const ring = document.createElement("div");
    ring.className = "actionFxCell actionDeployRing";
    ring.style.left = `${rect.x + rect.size * .15}px`;
    ring.style.top = `${rect.y + rect.size * .15}px`;
    ring.style.width = `${rect.size * .7}px`;
    ring.style.height = `${rect.size * .7}px`;
    layer.appendChild(ring);

    for (let i = 0; i < 7; i++) {
      const dust = document.createElement("span");
      dust.className = "actionDeployDust";
      const angle = Math.PI * 2 * i / 7;
      const distance = rect.size * (.3 + (i % 3) * .06);
      dust.style.left = `${rect.x + rect.size / 2 - 3}px`;
      dust.style.top = `${rect.y + rect.size / 2 - 3}px`;
      dust.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      dust.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      layer.appendChild(dust);
      setTimeout(() => dust.remove(), 520);
    }

    const cell = board()?.children[event.r * 9 + event.c];
    const unit = cell?.querySelector(".unit");
    if (unit) {
      unit.classList.remove("actionDeployUnit");
      void unit.offsetWidth;
      unit.classList.add("actionDeployUnit");
      setTimeout(() => unit.classList.remove("actionDeployUnit"), 450);
    }
    setTimeout(() => ring.remove(), 520);
    await delay(prefersReducedMotion ? 70 : 250);
  }

  async function playMove(event) {
    if (combatActive()) return;
    const layer = ensureLayer();
    const from = cellRect(event.r, event.c), to = cellRect(event.toR, event.toC);
    if (!layer || !from || !to) return;
    playSound("move");

    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const trail = document.createElement("div");
    trail.className = "actionMoveTrail";
    trail.style.left = `${from.x + from.size / 2}px`;
    trail.style.top = `${from.y + from.size / 2 - 2}px`;
    trail.style.width = `${length}px`;
    trail.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
    layer.appendChild(trail);

    const ghost = document.createElement("div");
    ghost.className = `actionMoveGhost p${event.pid}`;
    ghost.textContent = `${"★".repeat(event.stars)}${event.type}`;
    ghost.style.left = `${from.x + from.size * .12}px`;
    ghost.style.top = `${from.y + from.size * .12}px`;
    ghost.style.width = `${from.size * .76}px`;
    ghost.style.height = `${from.size * .76}px`;
    ghost.style.fontSize = `${Math.max(10, from.size * .18)}px`;
    layer.appendChild(ghost);

    const destCell = board()?.children[event.toR * 9 + event.toC];
    const realUnit = destCell?.querySelector(".unit");
    if (realUnit) realUnit.style.visibility = "hidden";

    const duration = prefersReducedMotion ? 90 : 330;
    if (ghost.animate) {
      await ghost.animate([
        { transform: "translate(0,0) scale(.92)", opacity: .86 },
        { transform: `translate(${dx}px,${dy}px) scale(1.06)`, opacity: 1 },
      ], { duration, easing: "cubic-bezier(.2,.72,.2,1)", fill: "forwards" }).finished.catch(() => {});
    } else {
      ghost.style.transform = `translate(${dx}px,${dy}px)`;
      await delay(duration);
    }
    if (realUnit) realUnit.style.visibility = "";
    ghost.remove();
    trail.remove();
  }

  async function playArtillery(event) {
    if (combatActive()) return;
    const layer = ensureLayer();
    const center = cellRect(event.r, event.c);
    if (!layer || !center) return;
    playSound("artillery");

    const rules = Engine.artilleryRules?.();
    const radius = Number(rules?.radius ?? 1);
    const centerDamage = Number(rules?.center ?? 0);
    const outerDamage = Number(rules?.outer ?? 0);

    const boardEl = board();
    if (boardEl && !prefersReducedMotion) {
      boardEl.classList.remove("actionBoardShake");
      void boardEl.offsetWidth;
      boardEl.classList.add("actionBoardShake");
      setTimeout(() => boardEl.classList.remove("actionBoardShake"), 360);
    }

    for (let rr = event.r - radius; rr <= event.r + radius; rr++) {
      for (let cc = event.c - radius; cc <= event.c + radius; cc++) {
        if (rr < 0 || cc < 0 || rr > 8 || cc > 8) continue;
        const rect = cellRect(rr, cc);
        if (!rect) continue;
        const tile = document.createElement("div");
        tile.className = `actionBlastTile ${rr === event.r && cc === event.c ? "center" : "outer"}`;
        tile.style.left = `${rect.x + rect.size * .05}px`;
        tile.style.top = `${rect.y + rect.size * .05}px`;
        tile.style.width = `${rect.size * .9}px`;
        tile.style.height = `${rect.size * .9}px`;
        layer.appendChild(tile);
        setTimeout(() => tile.remove(), 700);
      }
    }

    const shock = document.createElement("div");
    shock.className = "actionBlastCore";
    shock.style.left = `${center.x + center.size * .18}px`;
    shock.style.top = `${center.y + center.size * .18}px`;
    shock.style.width = `${center.size * .64}px`;
    shock.style.height = `${center.size * .64}px`;
    layer.appendChild(shock);

    const label = document.createElement("div");
    label.className = "actionBlastLabel";
    label.style.left = `${center.x + center.size / 2}px`;
    label.style.top = `${center.y + center.size * .42}px`;
    label.textContent = centerDamage && outerDamage
      ? `炮擊｜中心 ${centerDamage}／外圈 ${outerDamage}`
      : "炮擊";
    layer.appendChild(label);

    for (let i = 0; i < 12; i++) {
      const spark = document.createElement("span");
      spark.className = "actionSpark";
      const angle = Math.PI * 2 * i / 12 + (i % 2) * .12;
      const distance = center.size * (.75 + (i % 4) * .14);
      spark.style.left = `${center.x + center.size / 2}px`;
      spark.style.top = `${center.y + center.size / 2}px`;
      spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      layer.appendChild(spark);
      setTimeout(() => spark.remove(), 720);
    }

    setTimeout(() => shock.remove(), 760);
    setTimeout(() => label.remove(), 820);
    await delay(prefersReducedMotion ? 100 : 500);
  }

  async function playEvent(event) {
    try {
      if (event.kind === "deploy") await playDeploy(event);
      else if (event.kind === "move") await playMove(event);
      else if (event.kind === "artillery") await playArtillery(event);
    } catch (error) {
      console.warn("Action feedback failed:", error);
    }
  }

  function processLogs() {
    scheduled = false;
    const events = currentEvents();

    if (initialized && !events.length && boardIsEmpty()) {
      seen.clear();
      return;
    }

    if (!initialized) {
      for (const item of events) seen.add(item.text);
      initialized = true;
      return;
    }

    for (const item of events) {
      if (seen.has(item.text)) continue;
      seen.add(item.text);
      queue = queue.then(() => playEvent(item.event));
    }
  }

  function scheduleProcess() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(processLogs);
  }

  addSoundToggle();
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("keydown", unlockAudio);
  globalThis.addEventListener("resize", ensureLayer);

  const logEl = log();
  if (logEl) {
    new MutationObserver(scheduleProcess).observe(logEl, { childList: true, subtree: true, characterData: true });
  }

  const menuPanel = document.querySelector(".matchMenuPanel");
  if (menuPanel) {
    new MutationObserver(addSoundToggle).observe(menuPanel, { childList: true });
  }

  processLogs();
})();

// ---- 戰鬥命中感與終局完成感：只讀既有戰鬥演出 DOM，不重算任何傷害 ----
(() => {
  if (globalThis.__fiveLineCombatFeedback) return;
  const UI = globalThis.AlphaUI;
  if (!UI) return;
  globalThis.__fiveLineCombatFeedback = true;

  const SOUND_KEY = "five-line-sound-enabled";
  const reduced = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let audio = null;
  let lastStep = "";
  let victoryPlayed = false;

  const board = () => document.querySelector("#board");
  const stage = () => document.querySelector("#combatStage");
  const label = () => document.querySelector("#combatStepLabel");
  const pieces = () => document.querySelector("#combatPieces");
  const resultOverlay = () => document.querySelector("#resultOverlay");

  const style = document.createElement("style");
  style.textContent = `
    .combatFxOverlay{position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none;border-radius:8px}
    .combatFxFlash{position:absolute;inset:-8%;opacity:0;pointer-events:none}
    .combatFxFlash.attack{background:radial-gradient(circle at 50% 50%,rgba(255,244,198,.24),rgba(255,132,89,.08) 38%,transparent 68%);animation:combatFxFlash .34s ease-out}
    .combatFxFlash.guard{background:radial-gradient(circle at 50% 50%,rgba(109,219,124,.18),transparent 62%);animation:combatFxGuard .48s ease-out}
    .combatFxFlash.damage{background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.22),rgba(222,74,58,.13) 40%,transparent 72%);animation:combatFxFlash .42s ease-out}
    .combatFxFlash.reflect{background:radial-gradient(circle at 50% 50%,rgba(229,153,247,.3),rgba(137,73,178,.12) 42%,transparent 72%);animation:combatFxReflect .56s ease-out}
    .combatFxSlash{position:absolute;left:12%;top:49%;width:76%;height:5px;border-radius:999px;background:linear-gradient(90deg,transparent,#fff1a8 23%,#ffd43b 50%,#fff1a8 77%,transparent);box-shadow:0 0 18px #ffd43b,0 0 34px rgba(245,159,0,.65);transform:rotate(-11deg) scaleX(.05);transform-origin:center;animation:combatFxSlash .55s cubic-bezier(.18,.8,.2,1) forwards}
    .combatFxBoardHit{animation:combatFxBoardHit .28s ease-out}
    .combatFxBoardHeavy{animation:combatFxBoardHeavy .38s ease-out}
    .combatFxShard{position:absolute;z-index:7;width:7px;height:7px;border-radius:2px;background:#d9c38c;box-shadow:0 0 8px rgba(255,220,139,.8);pointer-events:none;animation:combatFxShard .52s ease-out forwards}
    .combatFxShard.p1{background:#ff8787;box-shadow:0 0 8px rgba(255,135,135,.8)}
    .combatFxShard.p2{background:#74c0fc;box-shadow:0 0 8px rgba(116,192,252,.8)}
    .cell.final-five-p1.combatVictoryCell,.cell.final-five-p2.combatVictoryCell{animation:combatVictoryCell .72s ease-out both;animation-delay:var(--victory-delay,0ms)}
    .resultBox.combatResultEnter{animation:combatResultEnter .46s cubic-bezier(.18,.82,.2,1)}
    .resultOverlay.combatResultGlow::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 72% 50%,rgba(255,212,59,.16),transparent 46%);animation:combatResultGlow 1.1s ease-out forwards}
    @keyframes combatFxFlash{0%{opacity:0;transform:scale(.82)}22%{opacity:1}100%{opacity:0;transform:scale(1.12)}}
    @keyframes combatFxGuard{0%{opacity:0;transform:scale(.76)}35%{opacity:1}100%{opacity:0;transform:scale(1.18)}}
    @keyframes combatFxReflect{0%{opacity:0;transform:scale(.62)}32%{opacity:1}100%{opacity:0;transform:scale(1.28)}}
    @keyframes combatFxSlash{0%{opacity:0;transform:rotate(-11deg) scaleX(.05)}18%{opacity:1}64%{opacity:1;transform:rotate(-11deg) scaleX(1)}100%{opacity:0;transform:rotate(-11deg) translateX(8%) scaleX(1.08)}}
    @keyframes combatFxBoardHit{0%,100%{transform:translate(0,0)}30%{transform:translate(-2px,1px)}60%{transform:translate(2px,-1px)}}
    @keyframes combatFxBoardHeavy{0%,100%{transform:translate(0,0)}18%{transform:translate(-4px,2px)}38%{transform:translate(4px,-2px)}58%{transform:translate(-3px,1px)}78%{transform:translate(2px,-1px)}}
    @keyframes combatFxShard{0%{opacity:1;transform:translate(-50%,-50%) rotate(0) scale(1)}100%{opacity:0;transform:translate(calc(-50% + var(--sx)),calc(-50% + var(--sy))) rotate(var(--sr)) scale(.18)}}
    @keyframes combatVictoryCell{0%{filter:brightness(1);transform:scale(1)}38%{filter:brightness(1.8);transform:scale(1.035);box-shadow:inset 0 0 0 4px #ffe066,inset 0 0 30px rgba(255,212,59,.48),0 0 18px rgba(255,212,59,.4)}100%{filter:brightness(1);transform:scale(1)}}
    @keyframes combatResultEnter{0%{opacity:0;transform:translateX(34px) scale(.97)}100%{opacity:1;transform:translateX(0) scale(1)}}
    @keyframes combatResultGlow{0%{opacity:0}28%{opacity:1}100%{opacity:0}}
    @media(prefers-reduced-motion:reduce){
      .combatFxFlash,.combatFxSlash,.combatFxBoardHit,.combatFxBoardHeavy,.combatFxShard,.combatVictoryCell,.resultBox.combatResultEnter,.resultOverlay.combatResultGlow::before{animation-duration:.08s!important;animation-delay:0ms!important}
    }
  `;
  document.head.appendChild(style);

  function soundOn() {
    return localStorage.getItem(SOUND_KEY) !== "off";
  }

  function unlock() {
    if (!soundOn()) return;
    try {
      if (!audio) {
        const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctx) return;
        audio = new Ctx();
      }
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {}
  }

  function beep(start, end, duration, gain, type = "sine", delay = 0) {
    if (!soundOn()) return;
    unlock();
    if (!audio || audio.state === "suspended") return;
    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    amp.gain.setValueAtTime(.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + .01);
    amp.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(amp).connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + .02);
  }

  function noise(duration = .12, gain = .035) {
    if (!soundOn()) return;
    unlock();
    if (!audio || audio.state === "suspended") return;
    const frames = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audio.createBufferSource();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1450;
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(filter).connect(amp).connect(audio.destination);
    src.start();
  }

  function ensureFxLayer() {
    const root = stage();
    if (!root) return null;
    let layer = root.querySelector(".combatFxOverlay");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "combatFxOverlay";
      layer.setAttribute("aria-hidden", "true");
      root.appendChild(layer);
    }
    return layer;
  }

  function flash(kind) {
    const layer = ensureFxLayer();
    if (!layer) return;
    const node = document.createElement("div");
    node.className = `combatFxFlash ${kind}`;
    layer.appendChild(node);
    setTimeout(() => node.remove(), reduced ? 120 : 700);
  }

  function slash() {
    const layer = ensureFxLayer();
    if (!layer) return;
    const node = document.createElement("div");
    node.className = "combatFxSlash";
    layer.appendChild(node);
    setTimeout(() => node.remove(), reduced ? 120 : 720);
  }

  function shake(heavy = false) {
    const node = board();
    if (!node || reduced) return;
    const cls = heavy ? "combatFxBoardHeavy" : "combatFxBoardHit";
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), heavy ? 450 : 330);
  }

  function playStepSound(kind) {
    if (kind === "attack") {
      beep(170, 105, .11, .03, "square");
    } else if (kind === "guard") {
      beep(260, 190, .12, .025, "triangle");
    } else if (kind === "damage") {
      beep(95, 54, .18, .045, "triangle");
      noise(.12, .03);
    } else if (kind === "cleave") {
      beep(760, 180, .2, .04, "sawtooth");
    } else if (kind === "reflect") {
      beep(185, 520, .22, .035, "sine");
      beep(350, 680, .16, .02, "triangle", .04);
    } else if (kind === "death") {
      beep(130, 52, .16, .024, "triangle");
    }
  }

  function stepKind(text) {
    if (/主攻擊/.test(text)) return "attack";
    if (/傷害與陣亡/.test(text)) return "damage";
    if (/斬入/.test(text)) return "cleave";
    if (/反震/.test(text)) return "reflect";
    return "";
  }

  function syncStep() {
    const text = label()?.textContent || "";
    const root = stage();
    if (!root || root.classList.contains("hidden")) {
      lastStep = "";
      return;
    }
    if (!text || text === lastStep) return;
    lastStep = text;
    const kind = stepKind(text);
    if (!kind) return;

    if (kind === "attack") {
      flash("attack");
      playStepSound("attack");
      requestAnimationFrame(() => {
        if (document.querySelector(".combatGuardLine")) {
          flash("guard");
          playStepSound("guard");
        }
      });
    } else if (kind === "damage") {
      flash("damage");
      shake(false);
      playStepSound("damage");
    } else if (kind === "cleave") {
      slash();
      shake(false);
      playStepSound("cleave");
    } else if (kind === "reflect") {
      flash("reflect");
      shake(true);
      playStepSound("reflect");
    }
  }

  function burstDeath(piece) {
    if (!piece || piece.dataset.combatFxDeath === "1") return;
    piece.dataset.combatFxDeath = "1";
    const container = pieces();
    if (!container) return;
    const left = parseFloat(piece.style.left || "50");
    const top = parseFloat(piece.style.top || "50");
    const pidClass = piece.classList.contains("p2") ? "p2" : "p1";
    for (let i = 0; i < 7; i++) {
      const shard = document.createElement("span");
      shard.className = `combatFxShard ${pidClass}`;
      shard.style.left = `${left}%`;
      shard.style.top = `${top}%`;
      const angle = Math.PI * 2 * i / 7 + .2;
      const distance = 18 + (i % 3) * 8;
      shard.style.setProperty("--sx", `${Math.cos(angle) * distance}px`);
      shard.style.setProperty("--sy", `${Math.sin(angle) * distance}px`);
      shard.style.setProperty("--sr", `${(i % 2 ? -1 : 1) * (80 + i * 19)}deg`);
      container.appendChild(shard);
      setTimeout(() => shard.remove(), reduced ? 120 : 620);
    }
    playStepSound("death");
  }

  function syncDeaths() {
    const container = pieces();
    if (!container) return;
    for (const piece of container.querySelectorAll(".combatDeathPiece.combatDeathFading")) burstDeath(piece);
  }

  function syncVictory() {
    const overlay = resultOverlay();
    const open = Boolean(overlay && !overlay.classList.contains("hidden"));
    if (!open) {
      victoryPlayed = false;
      for (const cell of document.querySelectorAll(".combatVictoryCell")) {
        cell.classList.remove("combatVictoryCell");
        cell.style.removeProperty("--victory-delay");
      }
      return;
    }
    if (victoryPlayed) return;
    victoryPlayed = true;
    const cells = [...document.querySelectorAll(".cell.final-five-p1,.cell.final-five-p2")];
    cells.sort((a, b) => [...a.parentElement.children].indexOf(a) - [...b.parentElement.children].indexOf(b));
    cells.forEach((cell, index) => {
      cell.style.setProperty("--victory-delay", `${index * 90}ms`);
      cell.classList.add("combatVictoryCell");
    });
    const box = overlay?.querySelector(".resultBox");
    box?.classList.remove("combatResultEnter");
    if (box) {
      void box.offsetWidth;
      box.classList.add("combatResultEnter");
    }
    overlay?.classList.add("combatResultGlow");
    setTimeout(() => overlay?.classList.remove("combatResultGlow"), 1250);
    if (cells.length) {
      beep(330, 440, .18, .026, "triangle");
      beep(440, 555, .18, .024, "triangle", .12);
      beep(555, 740, .26, .022, "sine", .24);
    }
  }

  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);

  const stepLabel = label();
  if (stepLabel) {
    new MutationObserver(() => queueMicrotask(syncStep))
      .observe(stepLabel, { childList: true, subtree: true, characterData: true });
  }
  const combatPieces = pieces();
  if (combatPieces) {
    new MutationObserver(() => queueMicrotask(syncDeaths))
      .observe(combatPieces, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  const combatStage = stage();
  if (combatStage) {
    new MutationObserver(() => {
      queueMicrotask(syncStep);
      queueMicrotask(syncDeaths);
    }).observe(combatStage, { attributes: true, attributeFilter: ["class"] });
  }
  const results = resultOverlay();
  if (results) {
    new MutationObserver(() => queueMicrotask(syncVictory))
      .observe(results, { attributes: true, attributeFilter: ["class"] });
  }

  syncStep();
  syncDeaths();
  syncVictory();
})();
