// Alpha Core v1 正式規則的 deterministic 測試。
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameEngine, TYPES, baseStats, cardCost } = require("../game_engine");

// 固定 P1 先手，讓跨回合的測試不受交替先手影響
const game = () => new GameEngine({ matchId: "alpha", roomCode: "ALPHA1", randomInt: () => 0,
  turnOrderMode: "fixed", startingPlayer: 1 });
const intent = (engine, fields) => ({ ...fields, turnId: engine.turnId });

// 直接擺盤用的裸引擎：清空棋盤，自己放單位，手動叫 resolveCombat
function bench() {
  const engine = game();
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  let nextId = 1;
  engine.put = (r, c, pid, type, rank, hp) => {
    const stats = baseStats(type, rank);
    const unit = {
      id: nextId++, pid, type, rank, cards: cardCost(rank),
      hp: hp === undefined ? stats.maxHp : hp, maxHp: stats.maxHp, atk: stats.atk,
    };
    engine.board[r][c] = unit;
    return unit;
  };
  return engine;
}
const at = (engine, r, c) => engine.board[r][c];
const hpOf = unit => (unit ? Math.max(0, unit.hp) : 0);

/* ---------------- 一、★★ 基礎規則 ---------------- */

test("01 同玩家同兵種不能同時存在兩隻★★", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 2 })).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  engine.players[0].hand = Array(5).fill("sword");
  const second = engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 2 }));
  assert.equal(second.ok, false);
  assert.match(second.error, /同兵種同時只能有一隻/);
});

test("02 ★★死亡後可以再次形成同兵種★★", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 2 })).ok, true);
  assert.equal(engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 })).ok, true);
  // 該★★陣亡：3 張原始卡一起進 cooldown
  engine.board[0][0].hp = 0;
  const deaths = [];
  engine.removeDead("combat", deaths);
  assert.equal(deaths.length, 1);
  assert.equal(engine.players[0].cooldown.length, 3);
  // 上限解除，同兵種★★可以再次形成
  engine.players[0].hand = Array(5).fill("sword");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 2 })).ok, true);
  assert.equal(engine.board[0][2].rank, 2);
});

test("03 上限擋下★★時仍可正常部署★，不會卡死行動", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  engine.deploy(1, intent(engine, { r: 0, c: 0, type: "sword", rank: 2 }));
  engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 }));
  engine.players[0].hand = Array(5).fill("sword");
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 2 })).ok, false);
  assert.equal(engine.deploy(1, intent(engine, { r: 0, c: 2, type: "sword", rank: 1 })).ok, true);
});

test("04 ★★★無法生成", () => {
  const engine = game();
  engine.players[0].hand = Array(5).fill("sword");
  assert.equal(engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 3 })).ok, false);
  assert.equal(cardCost(3), 0);
  assert.equal(baseStats("sword", 3), null);
  assert.equal(engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 0 })).ok, false);
});

test("05 ★★ HP = 1.5× 且 ATK = 1×", () => {
  for (const type of ["sword", "shield", "spear"]) {
    const one = baseStats(type, 1), elite = baseStats(type, 2);
    assert.equal(elite.maxHp, Math.round(TYPES[type].hp * 1.5));
    assert.equal(elite.atk, one.atk);
  }
  assert.equal(baseStats("sword", 2).maxHp, 180);
  assert.equal(baseStats("shield", 2).maxHp, 240);
  assert.equal(baseStats("spear", 2).maxHp, 180);
  assert.equal(baseStats("sword", 2).atk, 24);
});

/* ---------------- 二、★★劍 斬入 ---------------- */

test("06 ★★劍擊殺後強制斬入，並對最低HP敵人追擊", () => {
  const engine = bench();
  const sword = engine.put(4, 4, 1, "sword", 2);
  engine.put(4, 5, 2, "spear", 1, 10);          // 會被一擊打死
  const far = engine.put(4, 6, 2, "spear", 1);  // 死亡格的鄰居
  const result = engine.resolveCombat();
  assert.equal(engine.board[4][4], null, "原格必須清空");
  assert.equal(at(engine, 4, 5).id, sword.id, "★★劍必須移動到死亡格");
  assert.equal(result.cleaves.length, 1);
  assert.ok(result.cleaves[0].followUp, "應有追擊");
  // 追擊 = 100% base ATK 24 × 劍剋槍 1.25 = 30
  assert.equal(result.cleaves[0].followUp.damage, 30);
  assert.equal(hpOf(far), 120 - 30);
});

test("07 未擊殺就不斬入", () => {
  const engine = bench();
  engine.put(4, 4, 1, "sword", 2);
  engine.put(4, 5, 2, "spear", 1);              // 滿血，一擊打不死
  const result = engine.resolveCombat();
  assert.equal(result.cleaves.length, 0);
  assert.equal(at(engine, 4, 4).type, "sword", "★★劍留在原地");
});

test("08 ★★劍在主戰鬥中已死亡則不得斬入", () => {
  const engine = bench();
  engine.put(4, 4, 1, "sword", 2, 5);           // 殘血，會被反殺
  engine.put(4, 5, 2, "spear", 1, 10);          // 同輪也會死
  const result = engine.resolveCombat();
  assert.equal(result.cleaves.length, 0);
  assert.equal(engine.board[4][4], null);
  assert.equal(engine.board[4][5], null);
});

test("09 追擊選擇目前HP最低的敵人", () => {
  const engine = bench();
  engine.put(4, 4, 1, "sword", 2);
  engine.put(4, 5, 2, "spear", 1, 10);
  const high = engine.put(4, 6, 2, "spear", 1, 100);
  const low = engine.put(3, 5, 2, "spear", 1, 40);
  const result = engine.resolveCombat();
  assert.equal(result.cleaves[0].followUp.unitId, low.id, "應打 HP 較低的那個");
  assert.equal(hpOf(low), 40 - 30);
  assert.equal(hpOf(high), 100);
});

test("10 追擊擊殺不得再次斬入（禁止 chain）", () => {
  const engine = bench();
  const sword = engine.put(4, 4, 1, "sword", 2);
  engine.put(4, 5, 2, "spear", 1, 10);
  engine.put(4, 6, 2, "spear", 1, 10);          // 會被追擊打死
  const behind = engine.put(4, 7, 2, "spear", 1);
  const result = engine.resolveCombat();
  assert.equal(result.cleaves.length, 1, "整個結算只能斬入一次");
  assert.equal(engine.board[4][6], null, "追擊目標死亡");
  assert.equal(at(engine, 4, 5).id, sword.id, "★★劍停在第一次斬入的格子");
  assert.equal(hpOf(behind), 120, "更後方的敵人不得受影響");
});

/* ---------------- 三、★★盾 ---------------- */

test("11 ★★盾完全不主動攻擊", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const foe = engine.put(4, 5, 2, "sword", 1);
  assert.deepEqual(engine.attackTargets(4, 4, shield), []);
  const result = engine.resolveCombat();
  assert.equal(result.packets.filter(p => p.from.unitId === shield.id).length, 0);
  // 敵人只受到反震，沒有受到盾的普通攻擊
  const reflected = result.reflections.reduce((s, x) => s + x.damage, 0);
  assert.equal(hpOf(foe), 120 - reflected);
});

test("12 ★★盾提供 50% 鄰接護衛", () => {
  const engine = bench();
  engine.put(4, 4, 1, "shield", 2);
  const ally = engine.put(4, 3, 1, "sword", 1);
  engine.put(4, 2, 2, "sword", 1);              // 打 ally：單目標決鬥 24×1.5 = 36
  const result = engine.resolveCombat();
  const allyDmg = result.damage.find(d => d.unitId === ally.id);
  assert.equal(allyDmg.damage, 18, "友軍只吃一半");
  const shieldDmg = result.damage.find(d => d.type === "shield");
  assert.equal(shieldDmg.damage, 18, "另一半轉給★★盾");
});

test("13 ★★盾實際承受 20 → 反震 20", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const foe = engine.put(4, 5, 2, "shield", 1); // 盾打盾：20 ATK、無互剋、單目標非劍無決鬥
  const result = engine.resolveCombat();
  const taken = result.damage.find(d => d.unitId === shield.id);
  assert.equal(taken.damage, 20);
  assert.equal(taken.actualDamage, 20);
  assert.equal(result.reflections.length, 1);
  assert.equal(result.reflections[0].damage, 20, "反震 = 實際承受");
  assert.equal(hpOf(foe), 160 - 20);
});

test("14 經護衛轉移實際承受 10 → 對原傷害來源反震 10", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const ally = engine.put(4, 3, 1, "spear", 1);
  const foe = engine.put(4, 2, 2, "shield", 1); // 盾打槍：20，無互剋
  const result = engine.resolveCombat();
  const allyDmg = result.damage.find(d => d.unitId === ally.id);
  const shieldDmg = result.damage.find(d => d.unitId === shield.id);
  assert.equal(allyDmg.damage, 10);
  assert.equal(shieldDmg.damage, 10, "護衛轉移 50%");
  assert.equal(result.reflections.length, 1);
  assert.equal(result.reflections[0].unitId, foe.id, "反震回原傷害來源");
  assert.equal(result.reflections[0].damage, 10);
});

test("15 ★★盾只剩12HP、收到30傷害 → 只反震12，且陣亡仍反震", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2, 12);
  const foe = engine.put(4, 5, 2, "spear", 1);  // 槍剋盾：24 × 1.5 = 36
  const result = engine.resolveCombat();
  const taken = result.damage.find(d => d.unitId === shield.id);
  assert.equal(taken.damage, 36);
  assert.equal(taken.actualDamage, 12, "實際只扣掉 12，不計 overkill");
  assert.equal(engine.board[4][4], null, "盾陣亡");
  assert.equal(result.reflections.length, 1, "陣亡的盾仍要反震本次已記錄的實際承傷");
  assert.equal(result.reflections[0].unitId, foe.id);
  assert.equal(result.reflections[0].damage, 12, "反震 12 而非 36");
  assert.equal(hpOf(foe), 120 - 12, "來源確實扣血");
});

test("16 反震不得 recursive：反震不會再觸發反震", () => {
  const engine = bench();
  engine.put(4, 4, 1, "shield", 2);
  engine.put(4, 5, 2, "shield", 2);             // 雙方都是★★盾，且都不主動攻擊
  const result = engine.resolveCombat();
  assert.equal(result.packets.length, 0, "兩隻★★盾都不攻擊");
  assert.equal(result.reflections.length, 0, "沒有傷害就沒有反震");
  assert.equal(hpOf(at(engine, 4, 4)), 240);
  assert.equal(hpOf(at(engine, 4, 5)), 240);
});

test("17 反震不得再次觸發護衛", () => {
  const engine = bench();
  engine.put(4, 4, 1, "shield", 2);
  const foe = engine.put(4, 5, 2, "sword", 1);      // 劍打盾：24×1.5 = 36
  const foeGuard = engine.put(4, 6, 2, "shield", 1);// 敵方的盾在攻擊者旁邊
  const before = hpOf(foeGuard);
  const result = engine.resolveCombat();
  const reflect = result.reflections.find(x => x.unitId === foe.id);
  assert.equal(reflect.damage, 36, "反震 36 全額打在攻擊者身上");
  assert.equal(hpOf(foeGuard), before, "敵方的盾不得替攻擊者分擔反震");
});

test("18 槍→★★盾：互剋傷害＋100%反震的最終雙方HP", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const spear = engine.put(4, 5, 2, "spear", 1);
  const result = engine.resolveCombat();
  // 槍 24 ATK，1 個方向 → share 24；槍剋盾 ×1.5 → 36
  assert.equal(result.damage.find(d => d.unitId === shield.id).damage, 36);
  assert.equal(hpOf(shield), 240 - 36, "★★盾 240 → 204");
  assert.equal(hpOf(spear), 120 - 36, "槍受到 36 反震 → 84");
});

test("19 劍→★★盾：最終雙方HP", () => {
  const engine = bench();
  const shield = engine.put(4, 4, 1, "shield", 2);
  const sword = engine.put(4, 5, 2, "sword", 1);
  const result = engine.resolveCombat();
  // 劍 24 ATK，單目標決鬥 ×1.5 = 36；劍不剋盾
  assert.equal(result.damage.find(d => d.unitId === shield.id).damage, 36);
  assert.equal(hpOf(shield), 240 - 36, "★★盾 240 → 204");
  assert.equal(hpOf(sword), 120 - 36, "劍受到 36 反震 → 84");
});

/* ---------------- 四、五 槍的方向分攤與射線 ---------------- */

test("20 普通槍按方向分攤 ATK", () => {
  for (const [dirs, expect] of [[1, 24], [2, 12], [3, 8], [4, 6]]) {
    const engine = bench();
    engine.put(4, 4, 1, "spear", 1);
    const cells = [[4, 5], [4, 3], [3, 4], [5, 4]].slice(0, dirs);
    const foes = cells.map(([r, c]) => engine.put(r, c, 2, "sword", 1));
    const result = engine.resolveCombat();
    for (const foe of foes) {
      const d = result.damage.find(x => x.unitId === foe.id);
      assert.equal(d.damage, expect, `${dirs} 個方向時每個目標應為 ${expect}`);
    }
  }
});

test("21 ★★槍同方向「敵→敵」= 100% + 50% directionShare", () => {
  const engine = bench();
  engine.put(4, 4, 1, "spear", 2);
  const near = engine.put(4, 5, 2, "sword", 1);
  const far = engine.put(4, 6, 2, "sword", 1);
  const result = engine.resolveCombat();
  assert.equal(result.damage.find(d => d.unitId === near.id).damage, 24, "第一格全額 share");
  assert.equal(result.damage.find(d => d.unitId === far.id).damage, 12, "第二格半額");
});

test("22 ★★槍同方向「友→敵」= 友軍0、第二格50%", () => {
  const engine = bench();
  const spear = engine.put(4, 4, 1, "spear", 2);
  const ally = engine.put(4, 5, 1, "sword", 1);
  const far = engine.put(4, 6, 2, "sword", 1);
  const result = engine.resolveCombat();
  assert.equal(result.packets.filter(p => p.from.unitId === spear.id && p.to.unitId === ally.id).length, 0,
    "友軍不受★★槍傷害");
  assert.equal(result.packets.find(p => p.from.unitId === spear.id && p.to.unitId === far.id).amount, 12);
});

test("23 ★★槍多方向仍依方向數分攤，第二格不增加分母", () => {
  const engine = bench();
  engine.put(4, 4, 1, "spear", 2);
  const near = [engine.put(4, 5, 2, "sword", 1), engine.put(4, 3, 2, "sword", 1)];
  const far = [engine.put(4, 6, 2, "sword", 1), engine.put(4, 2, 2, "sword", 1)];
  const result = engine.resolveCombat();
  for (const u of near) assert.equal(result.damage.find(d => d.unitId === u.id).damage, 12, "2 方向 → share 12");
  for (const u of far) assert.equal(result.damage.find(d => d.unitId === u.id).damage, 6, "第二格 6");
});

test("24 ★★槍 pre-counter 總輸出上限為 1.5× base ATK", () => {
  const layouts = [
    [[4, 5], [4, 6]],
    [[4, 5], [4, 6], [4, 3], [4, 2]],
    [[4, 5], [4, 6], [4, 3], [4, 2], [3, 4], [2, 4], [5, 4], [6, 4]],
  ];
  for (const cells of layouts) {
    const engine = bench();
    const spear = engine.put(4, 4, 1, "spear", 2);
    for (const [r, c] of cells) engine.put(r, c, 2, "sword", 1);   // 劍不被槍剋，互剋倍率 1
    const result = engine.resolveCombat();
    const total = result.packets.filter(p => p.from.unitId === spear.id).reduce((s, p) => s + p.amount, 0);
    assert.ok(total <= TYPES.spear.atk * 1.5 + 1e-9, `總輸出 ${total} 不得超過 36`);
    assert.equal(total, 36, "滿穿透時剛好 1.5×ATK");
  }
});

/* ---------------- 六、七 卡片與判勝 ---------------- */

test("25 ★★死亡時 3 張卡一起進 cooldown（3 回合）", () => {
  const engine = bench();
  engine.players[0].hand = [];
  engine.players[0].cooldown = [];
  engine.put(4, 4, 1, "sword", 2, 0);
  const deaths = [];
  engine.removeDead("combat", deaths);
  assert.equal(engine.players[0].cooldown.length, 3);
  assert.deepEqual(engine.players[0].cooldown.map(x => x.type), ["sword", "sword", "sword"]);
  assert.deepEqual(engine.players[0].cooldown.map(x => x.turns), [3, 3, 3]);
});

test("26 P1 單獨部署後不得提前判勝，也不得提前戰鬥", () => {
  const engine = game();
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let c = 0; c < 4; c++) {
    engine.board[4][c] = { id: 100 + c, pid: 1, type: "sword", rank: 1, cards: 1, hp: 120, maxHp: 120, atk: 24 };
  }
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  const combatBefore = engine.combatResolutionCount;
  assert.equal(engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 1 })).ok, true);
  assert.equal(engine.gameOver, false, "P1 落子完成五連也不得立即判勝");
  assert.equal(engine.winner, null);
  assert.equal(engine.combatResolutionCount, combatBefore, "第一位部署後不得結算戰鬥");
  assert.equal(engine.fiveLines(1).length, 1, "盤面上五連確實存在，只是還不能判勝");
});

test("27 P1+P2 兩手完成並結算後才判五連", () => {
  const engine = game();
  engine.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let c = 0; c < 4; c++) {
    engine.board[4][c] = { id: 100 + c, pid: 1, type: "sword", rank: 1, cards: 1, hp: 120, maxHp: 120, atk: 24 };
  }
  engine.players[0].hand = Array(5).fill("sword");
  engine.players[1].hand = Array(5).fill("shield");
  engine.deploy(1, intent(engine, { r: 4, c: 4, type: "sword", rank: 1 }));
  assert.equal(engine.gameOver, false);
  const outcome = engine.deploy(2, intent(engine, { r: 8, c: 8, type: "shield", rank: 1 }));
  assert.equal(outcome.ok, true);
  assert.equal(engine.combatResolutionCount, 1, "本輪恰好結算一次戰鬥");
  assert.equal(engine.gameOver, true);
  assert.equal(engine.winner, 1);
});

/* ---------------- 斬入的「親自致死」語意 ---------------- */

test("28 ★★劍貢獻最高但未親自致死 → 不斬入", () => {
  const engine = bench();
  const sword = engine.put(4, 4, 1, "sword", 2);
  const foe = engine.put(4, 5, 2, "spear", 1, 60);
  const ally = engine.put(3, 5, 1, "sword", 1);     // 友軍也打同一個目標
  const result = engine.resolveCombat();
  const own = result.packets.find(p => p.from.unitId === sword.id && p.to.unitId === foe.id);
  const helper = result.packets.find(p => p.from.unitId === ally.id && p.to.unitId === foe.id);
  assert.equal(own.amount, 45, "★★劍 24 × 決鬥1.5 × 劍剋槍1.25 = 45");
  assert.equal(helper.amount, 45);
  assert.equal(engine.board[4][5], null, "45 + 45 = 90 ≥ 60，目標確實死亡");
  assert.equal(result.cleaves.length, 0, "★★劍自己的 45 < 60，未親自致死 → 不得斬入");
  assert.equal(at(engine, 4, 4).id, sword.id, "★★劍留在原地");
  assert.ok(ally);
});

test("29 ★★劍自己的 main attack 親自致死 → 斬入（即使友軍也參與）", () => {
  const engine = bench();
  const sword = engine.put(4, 4, 1, "sword", 2);
  const foe = engine.put(4, 5, 2, "spear", 1, 40);
  engine.put(3, 5, 1, "sword", 1);                  // 友軍同樣參與攻擊
  const behind = engine.put(4, 6, 2, "spear", 1);
  const result = engine.resolveCombat();
  const own = result.packets.find(p => p.from.unitId === sword.id && p.to.unitId === foe.id);
  assert.equal(own.amount, 45, "★★劍單獨的 45 ≥ 40，足以親自致死");
  assert.equal(result.cleaves.length, 1, "應觸發斬入");
  assert.equal(engine.board[4][4], null, "原格清空");
  assert.equal(at(engine, 4, 5).id, sword.id, "移動到死亡格");
  assert.equal(result.cleaves[0].followUp.unitId, behind.id);
  assert.equal(result.cleaves[0].followUp.damage, 30, "追擊 24 × 劍剋槍1.25 = 30，不套決鬥");
  assert.equal(hpOf(behind), 120 - 30);
});

/* ---------------- 正式回合順序：固定 P1 → P2 → combat ---------------- */

test("30 連續三回合都是 P1 → P2 → combat，先行者不交替", () => {
  const { ALPHA_TURN_ORDER } = require("../game_engine");
  assert.deepEqual(ALPHA_TURN_ORDER, { turnOrderMode: "fixed", startingPlayer: 1 });

  const engine = new GameEngine({ randomInt: () => 0, ...ALPHA_TURN_ORDER });
  const order = [];
  for (let round = 1; round <= 3; round++) {
    assert.equal(engine.roundNo, round);
    assert.equal(engine.firstPlayerForRound(round), 1, `第 ${round} 輪必須由 P1 先行`);

    engine.players[0].hand = Array(5).fill("sword");
    engine.players[1].hand = Array(5).fill("shield");
    const combatBefore = engine.combatResolutionCount;

    assert.equal(engine.current, 1, `第 ${round} 輪應由 P1 開始`);
    order.push(engine.current);
    assert.equal(engine.deploy(1, intent(engine, { r: 0, c: round - 1, type: "sword", rank: 1 })).ok, true);
    assert.equal(engine.combatResolutionCount, combatBefore, "P1 部署後不得結算");

    assert.equal(engine.current, 2, `第 ${round} 輪 P1 之後應輪到 P2`);
    order.push(engine.current);
    assert.equal(engine.deploy(2, intent(engine, { r: 8, c: round - 1, type: "shield", rank: 1 })).ok, true);
    assert.equal(engine.combatResolutionCount, combatBefore + 1, "雙方行動後才結算一次");
  }
  assert.deepEqual(order, [1, 2, 1, 2, 1, 2]);
  assert.deepEqual(engine.roundRecords.map(record => record.firstPlayer), [1, 1, 1, 1]);
});

test("31 沒有任何玩家能跨回合取得連續兩次部署", () => {
  const { ALPHA_TURN_ORDER } = require("../game_engine");
  const engine = new GameEngine({ randomInt: () => 0, ...ALPHA_TURN_ORDER });
  const actors = [];
  for (let round = 1; round <= 4; round++) {
    engine.players[0].hand = Array(5).fill("sword");
    engine.players[1].hand = Array(5).fill("shield");
    for (const pid of [1, 2]) {
      actors.push(engine.current);
      const row = pid === 1 ? 0 : 8;
      assert.equal(engine.deploy(pid, intent(engine, { r: row, c: round - 1, type: pid === 1 ? "sword" : "shield", rank: 1 })).ok, true);
    }
  }
  // 相鄰兩次部署永遠是不同玩家，代表沒有任何人拿到連續兩次窗口
  for (let i = 1; i < actors.length; i++) {
    assert.notEqual(actors[i], actors[i - 1], `第 ${i} 與第 ${i + 1} 次部署不得由同一位玩家連續進行`);
  }
  assert.deepEqual(actors, [1, 2, 1, 2, 1, 2, 1, 2]);
});

test("32 /local 與正式連線建房使用同一組回合順序設定", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  // 單機直接套用 ALPHA_TURN_ORDER
  assert.match(read("local_client.js"), /new GameEngine\(\{ roomCode: "LOCAL1", \.\.\.ALPHA_TURN_ORDER \}\)/);
  // 連線建房預設 fixed，只有明確要求才會是 alternating
  assert.match(read("server.js"), /rawMode === "alternating" \? "alternating" : "fixed"/);
  assert.match(read("server.js"), /startingPlayer: room\.mode === "fixed" \? ALPHA_TURN_ORDER\.startingPlayer : undefined/);
  // 一般入口不會送出 alternating
  assert.match(read("alpha_client.js"), /get\("turnOrder"\) === "alternating" \? "alternating" : "fixed"/);
});
