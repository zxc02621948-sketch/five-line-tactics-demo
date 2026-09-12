// Alpha Core v1 平衡沙盤。
// 所有牌流、部署限制、炮擊、戰鬥、勝負、加賽與補給終局都直接呼叫 game_engine.js；
// 本檔只負責可重現的簡單 AI 決策與統計，不再複製一份規則引擎。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  GameEngine, DECK_TEMPLATE, ALPHA_TURN_ORDER,
} = require("./game_engine");

const N = 9;
const TYPE_LIST = ["sword", "shield", "spear"];
const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const GAMES_PER_LEG = Math.max(1, Number(process.env.GAMES_PER_LEG || 500));
const OUTPUT = process.env.BALANCE_OUTPUT
  ? path.resolve(process.env.BALANCE_OUTPUT)
  : path.join(__dirname, "simulation_report_alpha_core_v1.json");

const STYLES = Object.freeze({
  balanced: { name: "均衡", rankChance: 0.50, artillery: true, prefer: null },
  noArtillery: { name: "不用炮擊", rankChance: 0.50, artillery: false, prefer: null },
  noRank: { name: "只部署★", rankChance: 0, artillery: true, prefer: null },
  ranker: { name: "積極合成★★", rankChance: 1, artillery: true, prefer: null },
  spear: { name: "槍偏好", rankChance: 0.50, artillery: true, prefer: "spear" },
  shield: { name: "盾偏好", rankChance: 0.50, artillery: true, prefer: "shield" },
});

function makeRng(initial) {
  let state = initial >>> 0;
  return max => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * max);
  };
}

const inBounds = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

function cellScore(engine, r, c, pid) {
  if (engine.board[r][c]) return -Infinity;
  const opponent = pid === 1 ? 2 : 1;
  let score = 0.02 * (8 - Math.abs(r - 4) - Math.abs(c - 4));

  // 評估所有包含候選格的五格窗：先顧自己的五連，再阻擋對手四連。
  for (const [dr, dc] of LINE_DIRS) for (let offset = -4; offset <= 0; offset++) {
    let own = 1;
    let enemy = 0;
    let valid = true;
    for (let k = 0; k < 5; k++) {
      const step = offset + k;
      const rr = r + dr * step, cc = c + dc * step;
      if (!inBounds(rr, cc)) { valid = false; break; }
      if (step === 0) continue;
      const unit = engine.board[rr][cc];
      if (unit?.pid === pid) own++;
      else if (unit?.pid === opponent) enemy++;
    }
    if (!valid) continue;
    if (enemy === 0) score += [0, 1, 6, 35, 600, 12000][own];
    if (own === 1 && enemy > 0) score += [0, 1, 5, 40, 10000][enemy];
  }

  // Alpha 的消極判負要求玩家接戰；越接近門檻，接觸誘因越強。
  let contact = 0;
  for (const [dr, dc] of ORTHO) for (let distance = 1; distance <= 2; distance++) {
    const rr = r + dr * distance, cc = c + dc * distance;
    if (!inBounds(rr, cc)) break;
    const unit = engine.board[rr][cc];
    if (!unit) continue;
    if (unit.pid === opponent) contact += distance === 1 ? 2 : 1;
    break;
  }
  const urgency = engine.quietRounds > 0 ? 300 : engine.roundNo <= 2 ? 80 : 12;
  score += contact * urgency;
  return score;
}

function chooseCell(engine, pid, rng) {
  let bestScore = -Infinity;
  const best = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const score = cellScore(engine, r, c, pid);
    if (score > bestScore) {
      bestScore = score;
      best.length = 0;
      best.push([r, c]);
    } else if (score === bestScore) best.push([r, c]);
  }
  return best.length ? best[rng(best.length)] : null;
}

function chooseType(engine, pid, r, c, style, rng) {
  const hand = engine.players[pid - 1].hand;
  const counts = Object.fromEntries(TYPE_LIST.map(type => [type, hand.filter(card => card === type).length]));
  const catalog = GameEngine.unitCatalog();
  let bestScore = -Infinity;
  const best = [];
  for (const type of TYPE_LIST) {
    if (!counts[type]) continue;
    let score = counts[type] * 0.08 + (style.prefer === type ? 1.25 : 0);
    for (const [dr, dc] of ORTHO) for (let distance = 1; distance <= 2; distance++) {
      const rr = r + dr * distance, cc = c + dc * distance;
      if (!inBounds(rr, cc)) break;
      const unit = engine.board[rr][cc];
      if (!unit) continue;
      if (unit.pid !== pid && catalog[type].counters === unit.type) score += distance === 1 ? 2.5 : 1.25;
      if (unit.pid === pid && type === "shield" && distance === 1) score += 0.35;
      break;
    }
    if (score > bestScore) {
      bestScore = score;
      best.length = 0;
      best.push(type);
    } else if (score === bestScore) best.push(type);
  }
  return best.length ? best[rng(best.length)] : null;
}

function chooseRank(engine, pid, type, style, rng) {
  const count = engine.players[pid - 1].hand.filter(card => card === type).length;
  if (count < 3) return 1;
  const eliteExists = engine.board.flat().some(unit =>
    unit && unit.pid === pid && unit.type === type && unit.rank === 2);
  if (eliteExists) return 1;
  return rng(10000) < Math.round(style.rankChance * 10000) ? 2 : 1;
}

function artilleryPlan(engine, pid) {
  const rules = GameEngine.artilleryRules();
  let best = null;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let enemies = 0, allies = 0, kills = 0, losses = 0;
    for (let rr = r - rules.radius; rr <= r + rules.radius; rr++) {
      for (let cc = c - rules.radius; cc <= c + rules.radius; cc++) {
        if (!inBounds(rr, cc)) continue;
        const unit = engine.board[rr][cc];
        if (!unit) continue;
        const damage = rr === r && cc === c ? rules.center : rules.outer;
        if (unit.pid === pid) {
          allies++;
          if (unit.hp <= damage) losses++;
        } else {
          enemies++;
          if (unit.hp <= damage) kills++;
        }
      }
    }
    const score = enemies * 2 + kills * 18 - allies * 1.5 - losses * 20;
    if (!best || score > best.score) best = { r, c, score, enemies, kills };
  }
  return best;
}

function maybeArtillery(engine, pid, style) {
  if (!style.artillery) return false;
  const player = engine.players[pid - 1];
  if (player.artillery <= 0 || engine.artilleryUsedThisTurn || !player.hand.length) return false;
  const plan = artilleryPlan(engine, pid);
  if (!plan || (plan.kills === 0 && (plan.enemies < 3 || plan.score < 6))) return false;
  return engine.artillery(pid, { r: plan.r, c: plan.c, turnId: engine.turnId }).ok;
}

function playGame(seed, styles) {
  const engineRng = makeRng(seed ^ 0x9e3779b9);
  const aiRng = makeRng(seed ^ 0x85ebca6b);
  const engine = new GameEngine({
    roomCode: "SIM001",
    ...ALPHA_TURN_ORDER,
    randomInt: engineRng,
  });
  let actions = 0;
  let simulationError = null;
  while (!engine.gameOver && actions < 300) {
    const pid = engine.current;
    const style = styles[pid - 1];
    if (!engine.canAct(pid)) {
      simulationError = "non_terminal_no_action";
      break;
    }
    maybeArtillery(engine, pid, style);
    let result;
    if (engine.canDeploy(pid)) {
      const cell = chooseCell(engine, pid, aiRng);
      const type = cell && chooseType(engine, pid, cell[0], cell[1], style, aiRng);
      if (!cell || !type) {
        simulationError = "ai_no_choice";
        break;
      }
      const rank = chooseRank(engine, pid, type, style, aiRng);
      result = engine.deploy(pid, {
        r: cell[0], c: cell[1], type, rank, turnId: engine.turnId,
      });
      if (!result.ok && rank === 2) {
        result = engine.deploy(pid, {
          r: cell[0], c: cell[1], type, rank: 1, turnId: engine.turnId,
        });
      }
    } else {
      const moves = engine.legalMoves(pid);
      const move = moves[aiRng(moves.length)];
      result = engine.move(pid, {
        r: move.from[0], c: move.from[1], toR: move.to[0], toC: move.to[1], turnId: engine.turnId,
      });
    }
    if (!result.ok) {
      simulationError = `primary_action_rejected:${result.error}`;
      break;
    }
    const ended = engine.endTurn(pid, { turnId: engine.turnId });
    if (!ended.ok) {
      simulationError = `end_turn_rejected:${ended.error}`;
      break;
    }
    actions++;
  }
  if (!engine.gameOver && !simulationError) simulationError = "action_guard";
  return {
    winner: engine.winner,
    endReason: engine.endReason || simulationError,
    gameOver: engine.gameOver,
    rounds: engine.roundNo,
    actions,
    combatResolutions: engine.combatResolutionCount,
    deaths: engine.logs.filter(item => item.kind === "kill").length,
    artilleryShots: engine.artilleryEvents.length,
    rank2Deployments: engine.roundRecords.flatMap(round => round.actions)
      .filter(action => action.kind === "deploy" && action.rank === 2).length,
    cardConservationValid: engine.cardConservationAudits.every(item => item.valid),
  };
}

const average = (rows, key) => rows.length
  ? Number((rows.reduce((sum, row) => sum + row[key], 0) / rows.length).toFixed(3))
  : 0;
const rate = (value, total) => total ? Number((value / total).toFixed(4)) : 0;

function summarize(rows) {
  const endReasons = {};
  for (const row of rows) endReasons[row.endReason || "unknown"] = (endReasons[row.endReason || "unknown"] || 0) + 1;
  return {
    games: rows.length,
    p1_win_rate: rate(rows.filter(row => row.winner === 1).length, rows.length),
    p2_win_rate: rate(rows.filter(row => row.winner === 2).length, rows.length),
    draw_rate: rate(rows.filter(row => row.winner === "draw").length, rows.length),
    double_loss_rate: rate(rows.filter(row => row.winner === "double_loss").length, rows.length),
    non_terminal_rate: rate(rows.filter(row => !row.gameOver).length, rows.length),
    average_rounds: average(rows, "rounds"),
    average_deaths: average(rows, "deaths"),
    average_artillery_shots: average(rows, "artilleryShots"),
    average_rank2_deployments: average(rows, "rank2Deployments"),
    card_conservation_valid_rate: rate(rows.filter(row => row.cardConservationValid).length, rows.length),
    end_reasons: endReasons,
  };
}

function runLeg(styleP1, styleP2, seedBase, games = GAMES_PER_LEG) {
  return Array.from({ length: games }, (_, index) => ({
    ...playGame((seedBase + index * 7919) >>> 0, [styleP1, styleP2]),
    aPid: 1,
  }));
}

function mirroredMatchup(styleA, styleB, seedBase) {
  const first = runLeg(styleA, styleB, seedBase).map(row => ({ ...row, aPid: 1 }));
  const second = runLeg(styleB, styleA, seedBase ^ 0x27d4eb2d).map(row => ({ ...row, aPid: 2 }));
  const rows = [...first, ...second];
  const aWins = rows.filter(row => row.winner === row.aPid).length;
  const bWins = rows.filter(row => row.winner === (row.aPid === 1 ? 2 : 1)).length;
  return {
    style_a: styleA.name,
    style_b: styleB.name,
    style_a_win_rate: rate(aWins, rows.length),
    style_b_win_rate: rate(bWins, rows.length),
    other_result_rate: rate(rows.length - aWins - bWins, rows.length),
    aggregate: summarize(rows),
  };
}

function deckCounts() {
  return Object.fromEntries(TYPE_LIST.map(type => [type, DECK_TEMPLATE.filter(card => card === type).length]));
}

const baselineRows = runLeg(STYLES.balanced, STYLES.balanced, 0x1234abcd);
const enginePath = path.join(__dirname, "game_engine.js");
const report = {
  version: "alpha-core-v1-current-engine",
  generated_on: new Date().toISOString().slice(0, 10),
  game_engine_sha256: crypto.createHash("sha256").update(fs.readFileSync(enginePath)).digest("hex"),
  games_per_leg: GAMES_PER_LEG,
  methodology: {
    rules_source: "game_engine.js GameEngine（不複製戰鬥或勝負規則）",
    seed_policy: "fixed-lcg-mirrored-v1",
    ai_limitations: "簡單啟發式 AI；數據只用於版本內比較，不代表真人最佳策略或正式勝率。",
  },
  rules_snapshot: {
    board: "9x9",
    turn_order: ALPHA_TURN_ORDER,
    deck: deckCounts(),
    unit_catalog: GameEngine.unitCatalog(),
    artillery: GameEngine.artilleryRules(),
    overtime: GameEngine.overtimeRules(),
    no_legal_deployment: GameEngine.movementRules(),
    timeouts: GameEngine.timeoutRules(),
    rank3: "disabled",
  },
  baseline_balanced_vs_balanced: summarize(baselineRows),
  mirrored_matchups: {
    artillery_vs_no_artillery: mirroredMatchup(STYLES.balanced, STYLES.noArtillery, 0x31415926),
    rank2_vs_no_rank2: mirroredMatchup(STYLES.ranker, STYLES.noRank, 0x27182818),
    spear_preference_vs_shield_preference: mirroredMatchup(STYLES.spear, STYLES.shield, 0x16180339),
  },
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Current Alpha Core report written: ${OUTPUT}`);
