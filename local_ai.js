// 單機策略：只接收公開盤面與自己的手牌，不讀取對手手牌或任何牌庫順序。
// 評分權重是 AI 偏好；部署、炮擊、交戰、加賽與勝負全部交給正式引擎預演。
(() => {
  const { GameEngine, ALPHA_TURN_ORDER } = globalThis.FiveLineEngine;
  const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const LINE_WEIGHT = [0, 1, 6, 28, 190, 6000];
  const cloneBoard = board => board.map(row => row.map(unit => unit ? { ...unit } : null));
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const waitFrame = () => new Promise(resolve => setTimeout(resolve, 0));

  function shapeScore(board, pid) {
    let score = 0;
    for (let r = 0; r < board.length; r++) for (let c = 0; c < board[r].length; c++) {
      for (const [dr, dc] of DIRECTIONS) {
        let own = 0, enemy = 0, valid = true;
        for (let k = 0; k < LINE_WEIGHT.length - 1; k++) {
          const unit = board[r + dr * k]?.[c + dc * k];
          if (r + dr * k >= board.length || c + dc * k < 0 || c + dc * k >= board[r].length) { valid = false; break; }
          if (unit?.pid === pid) own++;
          else if (unit) enemy++;
        }
        if (!valid || (own && enemy)) continue;
        score += own ? LINE_WEIGHT[own] : enemy ? -LINE_WEIGHT[enemy] * 1.08 : 0;
      }
    }
    return score;
  }

  function unitValue(unit) {
    return 22 + unit.cards * 14 + Math.max(0, unit.hp) / unit.maxHp * 10;
  }
  function materialScore(board, pid) {
    let score = 0;
    for (const unit of board.flat()) if (unit) score += unitValue(unit) * (unit.pid === pid ? 1 : -1.15);
    return score;
  }
  function centerBias(action, board) {
    const r = action?.toR ?? action?.r, c = action?.toC ?? action?.c;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return 0;
    const mid = (board.length - 1) / 2;
    return -(Math.abs(r - mid) + Math.abs(c - mid)) * .12;
  }
  function apply(engine, pid, action) {
    const intent = { ...action, turnId: engine.turnId };
    if (action.kind === "deploy") return engine.deploy(pid, intent).ok;
    if (action.kind === "move") return engine.move(pid, intent).ok;
    if (action.kind === "artillery") return engine.artillery(pid, intent).ok;
    return false;
  }

  async function choose(snapshot, { budgetMs = 1200, isCancelled = () => false } = {}) {
    if (budgetMs <= 0 || isCancelled()) return null;
    const pid = snapshot.pid, enemyPid = 3 - pid;
    const started = clock(), deadline = started + Math.max(0, budgetMs);
    let slice = started;
    const rules = GameEngine.deploymentRules(), ammoRules = GameEngine.artilleryRules();
    // 合成的空牌庫只用來承接引擎內部記錄；抽牌結果不參與評分。
    // advanceAfterAction() 只推進這一次行動，不呼叫會猜測對手可行動性的自動跳回合迴圈。
    const sim = new GameEngine({ ...ALPHA_TURN_ORDER, randomInt: () => 0, now: () => snapshot.now });
    function restore(actions = []) {
      Object.assign(sim, {
        board: cloneBoard(snapshot.board),
        players: [1, 2].map(id => ({ id, deck: [], hand: id === pid ? [...snapshot.hand] : [],
          cooldown: [], artillery: snapshot.artillery[id] })),
        matchId: snapshot.matchId, current: pid, turnId: snapshot.turnId, roundNo: snapshot.roundNo,
        actionsThisRound: snapshot.actionsThisRound, deploymentCommitted: snapshot.deploymentCommitted,
        artilleryUsedThisTurn: snapshot.artilleryUsedThisTurn, nextUnitId: snapshot.nextUnitId,
        overtime: snapshot.overtime, overtimeStartRound: snapshot.overtimeStartRound, quietRounds: snapshot.quietRounds,
        gameOver: false, winner: null, endReason: null, finalFive: null,
        logs: [], roundRecords: [], artilleryEvents: [], cardConservationAudits: [], combatResolutionCount: 0,
      });
      for (const action of actions) if (!apply(sim, pid, action)) return false;
      return true;
    }
    async function available(until = deadline) {
      if (isCancelled()) return false;
      if (clock() - slice >= 8) { await waitFrame(); slice = clock(); }
      return !isCancelled() && clock() < until;
    }
    const scarcity = 1 - Math.min(1, snapshot.artillery[pid] / Math.max(1, ammoRules.perPlayer));
    function shotValue(before, event) {
      const after = new Map(sim.board.flat().filter(Boolean).map(unit => [unit.id, unit]));
      let score = event.preventedFour * 120 + event.preventedFive * 900;
      for (const unit of before.flat()) {
        if (!unit) continue;
        const survivor = after.get(unit.id);
        const lost = Math.max(0, unit.hp) - Math.max(0, survivor?.hp || 0);
        const enemy = unit.pid === enemyPid;
        score += lost * (enemy ? .24 : -.32);
        if (!survivor) score += unitValue(unit) * (enemy ? 1.35 : -1.65);
      }
      return score;
    }
    function evaluate(actions, main) {
      if (!restore(actions) || (!sim.deploymentCommitted && sim.canAct(pid))) return -Infinity;
      const beforeCombat = new Map(sim.board.flat().filter(Boolean).map(unit => [unit.id, { ...unit }]));
      sim.advanceAfterAction();
      if (sim.gameOver) return sim.winner === pid ? 1e9 : sim.winner === enemyPid ? -1e9 : -1e5;
      let score = shapeScore(sim.board, pid) + materialScore(sim.board, pid) + centerBias(main, sim.board);
      if (main?.kind === "deploy") {
        const spent = rules.ranks.find(option => option.rank === main.rank)?.cost || 0;
        score -= Math.max(0, spent - rules.ranks[0].cost) * 13;
      }
      const combat = sim.roundRecords.find(record => record.round === snapshot.roundNo)?.combat;
      for (const cleave of combat?.cleaves || []) score += cleave.pid === pid ? 18 : -18;
      for (const hit of combat?.reflections || []) {
        score += hit.damage * (beforeCombat.get(hit.shieldId)?.pid === pid ? .18 : -.18);
      }
      return score;
    }

    // 沿用既有策略：只有破線或交換價值很高時，才在主行動前花炮。
    let pre = null, preScore = 88 + scarcity * 20;
    restore();
    const canShoot = snapshot.artillery[pid] > 0 && !snapshot.artilleryUsedThisTurn;
    if (canShoot && sim.canAct(pid) && !snapshot.deploymentCommitted) {
      for (let r = 0; r < snapshot.board.length; r++) for (let c = 0; c < snapshot.board[r].length; c++) {
        if (!await available(started + Math.max(0, budgetMs) * .2)) break;
        restore();
        const result = sim.artillery(pid, { r, c, turnId: sim.turnId });
        if (!result.ok) continue;
        const score = shotValue(snapshot.board, result.event);
        if (score > preScore) { preScore = score; pre = { kind: "artillery", r, c }; }
      }
    }
    const prefix = pre ? [pre] : [];
    restore(prefix);
    const candidates = [];
    if (sim.deploymentCommitted || !sim.canAct(pid)) candidates.push(null);
    else if (!sim.canDeploy(pid)) {
      for (const move of sim.legalMoves(pid)) candidates.push({
        kind: "move", r: move.from[0], c: move.from[1], toR: move.to[0], toC: move.to[1],
      });
    } else {
      const counts = new Map();
      for (const type of snapshot.hand) counts.set(type, (counts.get(type) || 0) + 1);
      for (let r = 0; r < sim.board.length; r++) for (let c = 0; c < sim.board[r].length; c++) {
        if (sim.board[r][c]) continue;
        for (const [type, count] of counts) for (const option of rules.ranks) {
          if (count >= option.cost) candidates.push({ kind: "deploy", r, c, type, rank: option.rank });
        }
      }
    }
    // 先將有機會補線／阻擋的格子排前，再用引擎檢查它們是否真的能撐過交戰。
    const ordered = [];
    for (const main of candidates) {
      if (isCancelled()) return null;
      if (!restore(prefix) || (main && !apply(sim, pid, main))) continue;
      ordered.push({ main, rough: shapeScore(sim.board, pid) + centerBias(main, sim.board) });
      if (!await available()) break;
    }
    ordered.sort((a, b) => b.rough - a.rough);
    let best = null;
    const mainDeadline = deadline - Math.min(160, Math.max(0, budgetMs) * .2);
    for (const { main } of ordered) {
      if (isCancelled()) return null;
      const actions = main ? [...prefix, main] : [...prefix];
      const score = evaluate(actions, main);
      if (!best || score > best.score) best = { actions, main, score };
      if (!await available(mainDeadline)) break;
    }
    if (!best || isCancelled()) return null;
    // 主行動後再比一次：炮擊必須改善完整戰後結果，且要付出保留彈藥的機會成本。
    if (!pre && canShoot && best.score < 1e9) {
      const baseActions = best.actions, main = best.main, ammoCost = 66 + scarcity * 20;
      for (let r = 0; r < snapshot.board.length; r++) for (let c = 0; c < snapshot.board[r].length; c++) {
        if (!await available()) break;
        const actions = [...baseActions, { kind: "artillery", r, c }];
        const score = evaluate(actions, main) - ammoCost;
        if (score > best.score) best = { actions, main, score };
      }
    }
    return isCancelled() ? null : { actions: best.actions };
  }
  globalThis.FiveLineAI = { choose };
})();
