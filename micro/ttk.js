// 直接使用 game_engine.js 的正式規則（TYPES / baseStats / resolveCombat / 互剋 / 射程 / 同步結算）。
const { GameEngine, TYPES, baseStats, cardCost } = require("../game_engine.js");

const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };
const ADJ = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function makeUnit(pid, type, rank, id) {
  const stats = baseStats(type, rank);
  return { id, pid, type, rank, cards: cardCost(rank), hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk };
}

// 佈置：防守方 1 隻在 (4,4)，攻方 n 隻貼在正交相鄰格。回傳每輪結算後的戰場快照。
function simulate({ defType, defRank, atkType, atkRank, attackers }) {
  const engine = new GameEngine({});
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) engine.board[r][c] = null;
  const defender = makeUnit(1, defType, defRank, 0);
  engine.board[4][4] = defender;
  const atkUnits = [];
  for (let i = 0; i < attackers; i++) {
    const [dr, dc] = ADJ[i];
    const unit = makeUnit(2, atkType, atkRank, i + 1);
    engine.board[4 + dr][4 + dc] = unit;
    atkUnits.push(unit);
  }
  let defDeath = null;
  const atkDeaths = [];
  for (let tick = 1; tick <= 60; tick++) {
    engine.resolveCombat();
    const alive = new Set();
    for (const row of engine.board) for (const unit of row) if (unit) alive.add(unit.id);
    if (!alive.has(0) && defDeath === null) defDeath = tick;
    for (const unit of atkUnits) {
      if (!alive.has(unit.id) && !atkDeaths.some(item => item.id === unit.id)) {
        atkDeaths.push({ id: unit.id, tick });
      }
    }
    if (defDeath !== null || atkDeaths.length === atkUnits.length) {
      // 再跑到雙方其中一邊清空為止，才知道最終戰場
      if (defDeath !== null && atkDeaths.length === atkUnits.length) break;
      if (defDeath !== null) break;
    }
    if (atkDeaths.length === atkUnits.length) break;
  }
  const survivors = [];
  for (const row of engine.board) for (const unit of row) if (unit) {
    survivors.push(`${unit.pid === 1 ? "守" : "攻"}${"★".repeat(unit.rank)}${NAME[unit.type]}${Math.max(0, unit.hp)}`);
  }
  const mutual = defDeath !== null && atkDeaths.some(item => item.tick === defDeath);
  return { defDeath, atkDeaths, survivors, mutual, defender };
}

const cell = (text, width) => {
  let visible = 0;
  for (const char of String(text)) visible += /[\u4e00-\u9fff\u2605\uff08\uff09]/.test(char) ? 2 : 1;
  return String(text) + " ".repeat(Math.max(0, width - visible));
};

function relation(atk, def) {
  if (COUNTER[atk] === def) return "攻方剋守方";
  if (COUNTER[def] === atk) return "守方剋攻方";
  return "無互剋";
}

function report(title, rows) {
  console.log("\n" + "=".repeat(104));
  console.log(title);
  console.log("=".repeat(104));
  console.log(cell("情境", 30) + cell("互剋", 14) + cell("攻方部署", 10) + cell("守方死亡", 10)
    + cell("攻方陣亡", 10) + "戰場剩餘");
  console.log("-".repeat(104));
  for (const row of rows) console.log(row);
}

// ---- 1. 1★ 對 1★ 全兵種對照 ----
const rows1 = [];
for (const defType of ["sword", "shield", "spear"]) {
  for (const atkType of ["sword", "shield", "spear"]) {
    const result = simulate({ defType, defRank: 1, atkType, atkRank: 1, attackers: 1 });
    const defText = result.defDeath === null ? "不死" : `第${result.defDeath}次`;
    const atkText = result.atkDeaths.length ? `第${result.atkDeaths[0].tick}次` : "0 顆";
    rows1.push(cell(`守★${NAME[defType]} vs 攻★${NAME[atkType]}`, 30)
      + cell(relation(atkType, defType), 14) + cell("1 顆", 10)
      + cell(defText, 10) + cell(atkText, 10)
      + (result.mutual ? "同歸於盡" : result.survivors.join(" ") || "全滅"));
  }
}
report("表 1  1★ vs 1★ 單挑（每格＝一次同步結算）", rows1);

// ---- 2. 圍攻：1★ 與 2★ 被 1/2/3/4 隻同兵種一星圍攻 ----
for (const defRank of [1, 2]) {
  const rows = [];
  for (const defType of ["sword", "shield", "spear"]) {
    for (const atkType of ["sword", "shield", "spear"]) {
      for (const attackers of [2, 3, 4]) {
        const result = simulate({ defType, defRank, atkType, atkRank: 1, attackers });
        const defText = result.defDeath === null ? "不死" : `第${result.defDeath}次`;
        const dead = result.atkDeaths.length;
        rows.push(cell(`守${"★".repeat(defRank)}${NAME[defType]} ← ${attackers}×★${NAME[atkType]}`, 30)
          + cell(relation(atkType, defType), 14) + cell(`${attackers} 顆`, 10)
          + cell(defText, 10) + cell(`${dead} 顆`, 10)
          + (result.survivors.join(" ") || "全滅"));
      }
    }
  }
  report(`表 ${defRank + 1}  ${"★".repeat(defRank)} 被圍攻（攻方全為一星，貼身正交）`, rows);
}
