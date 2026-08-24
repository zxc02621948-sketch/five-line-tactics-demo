// ★★槍 新分攤定義的 deterministic 驗證。不修改 game_engine.js，不跑 Monte Carlo。
//
// 新規則：槍的 ATK 按「存在合法敵方攻擊目標的正交方向數」平均分配。
//   同一方向內：
//     第一格敵人           → 該方向份額 × 100%
//     ★★槍第二格敵人      → 該方向份額 × 50%
//     第一格友軍           → 友軍不受傷，但第二格敵人仍吃該方向份額 × 50%
//     第二格單位不額外增加分攤份數（份數只看方向數）
//   ★1 槍維持原射程判定（碰到任何佔用格即停），距離 2 命中仍為 50%。
//   兵種克制在「每個目標」上各自生效（沿用 game_engine.js 的 counterBonus）。
const { TYPES, baseStats } = require("../game_engine.js");
const COUNTER = { sword: "spear", spear: "shield", shield: "sword" };   // 同 game_engine.js:9
const NAME = { sword: "劍", shield: "盾", spear: "槍" };
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRNAME = { "1,0": "下", "-1,0": "上", "0,1": "右", "0,-1": "左" };
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;
const counterMult = (a, d) => COUNTER[a] !== d ? 1 : (a === "spear" && d === "shield" ? 1.5 : 1.25);

let nid = 1;
function mk(pid, type, rank) {
  const s = baseStats(type, rank);
  return { id: nid++, pid, type, rank, hp: s.maxHp, maxHp: s.maxHp, atk: TYPES[type].atk };
}

// 依新規則列出每個方向的命中清單
function scan(board, r, c, unit) {
  const dirs = [];
  for (const [dr, dc] of ORTHO) {
    const hits = [];
    for (let d = 1; d <= 2; d++) {
      const rr = r + dr * d, cc = c + dc * d;
      if (!inB(rr, cc)) break;
      const t = board[rr][cc];
      if (!t) continue;                                   // 空格：繼續往外看
      if (t.pid !== unit.pid) hits.push({ d, r: rr, c: cc, t });
      if (unit.rank !== 2) break;                         // ★1 槍：任何佔用格即停
      // ★★槍：友軍或敵人都不阻擋第二格
    }
    if (hits.length) dirs.push({ key: `${dr},${dc}`, hits });
  }
  return dirs;
}

function damage(board, r, c, unit) {
  const dirs = scan(board, r, c, unit);
  if (!dirs.length) return { dirs: 0, share: 0, packets: [], total: 0 };
  const share = unit.atk / dirs.length;                   // 份數 = 方向數，與目標數無關
  const packets = [];
  for (const dir of dirs) for (const h of dir.hits) {
    const distMult = h.d === 2 ? 0.5 : 1;
    const cm = counterMult(unit.type, h.t.type);
    packets.push({
      dir: DIRNAME[dir.key], dist: h.d, cell: `${h.r},${h.c}`, type: h.t.type,
      base: share * distMult, cm, amount: share * distMult * cm,
    });
  }
  return { dirs: dirs.length, share, packets, total: packets.reduce((s, p) => s + p.amount, 0) };
}

const w = (t, n) => { let v = 0; for (const ch of String(t)) v += /[一-鿿★→／]/.test(ch) ? 2 : 1; return String(t) + " ".repeat(Math.max(0, n - v)); };
const f = v => (Math.round(v * 100) / 100).toString();

function run(label, rank, spec, expectNote) {
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  const self = mk(1, "spear", rank);
  board[4][4] = self;
  for (const [r, c, pid, type] of spec) board[r][c] = mk(pid, type, 1);
  const res = damage(board, 4, 4, self);
  const noCounter = res.packets.reduce((s, p) => s + p.base, 0);
  console.log("\n" + w(label, 46) + `ATK ${self.atk}　方向數 ${res.dirs}　每方向份額 ${f(res.share)}`);
  for (const p of res.packets) {
    console.log("    " + w(`${p.dir} 距離${p.dist} (${p.cell}) ${NAME[p.type]}`, 26)
      + w(`份額×${p.dist === 2 ? "50%" : "100%"} = ${f(p.base)}`, 22)
      + (p.cm !== 1 ? `× 互剋${p.cm} = ${f(p.amount)}` : `（無互剋）= ${f(p.amount)}`));
  }
  console.log("    " + w("合計（未計互剋）", 26) + w(`${f(noCounter)}  = ATK × ${f(noCounter / self.atk)}`, 30)
    + `含互剋總輸出 ${f(res.total)}`);
  if (expectNote) console.log("    → " + expectNote);
  return { res, noCounter, atk: self.atk };
}

console.log("=".repeat(104));
console.log("★★槍 新分攤定義驗證（份數＝有合法目標的方向數；第二格不增加份數）");
console.log("=".repeat(104));

const checks = [];
checks.push(["1 方向 1 敵（距離1）", run("A1  1 方向・1 敵在 (4,5)", 2,
  [[4, 5, 2, "sword"]], "單方向獨吞全部 ATK")]);
checks.push(["1 方向 2 敵（穿透）", run("A2  1 方向・(4,5)(4,6) 兩敵", 2,
  [[4, 5, 2, "sword"], [4, 6, 2, "sword"]], "同方向 100% + 50% = 該方向 1.5 倍份額")]);
checks.push(["1 方向・第一格友軍", run("A3  1 方向・(4,5) 友軍 (4,6) 敵", 2,
  [[4, 5, 1, "sword"], [4, 6, 2, "sword"]], "友軍不受傷，敵人仍吃 50%；此方向仍算 1 份")]);
checks.push(["1 方向・僅第二格有敵", run("A4  1 方向・(4,5) 空 (4,6) 敵", 2,
  [[4, 6, 2, "sword"]], "只有 50%，方向份數仍是 1")]);
checks.push(["2 方向各 1 敵", run("B1  2 方向・右(4,5) 左(4,3)", 2,
  [[4, 5, 2, "sword"], [4, 3, 2, "sword"]], "ATK 對半")]);
checks.push(["2 方向・一邊穿透", run("B2  右(4,5)(4,6) 兩敵、左(4,3) 一敵", 2,
  [[4, 5, 2, "sword"], [4, 6, 2, "sword"], [4, 3, 2, "sword"]], "右方向 1.5 份額、左方向 1 份額")]);
checks.push(["3 方向各 1 敵", run("C1  3 方向", 2,
  [[4, 5, 2, "sword"], [4, 3, 2, "sword"], [3, 4, 2, "sword"]], "ATK 三等分")]);
checks.push(["4 方向各 1 敵", run("D1  4 方向", 2,
  [[4, 5, 2, "sword"], [4, 3, 2, "sword"], [3, 4, 2, "sword"], [5, 4, 2, "sword"]], "ATK 四等分")]);
checks.push(["4 方向各 2 敵（最大）", run("D2  4 方向 × 各 2 敵（8 目標）", 2,
  [[4, 5, 2, "sword"], [4, 6, 2, "sword"], [4, 3, 2, "sword"], [4, 2, 2, "sword"],
   [3, 4, 2, "sword"], [2, 4, 2, "sword"], [5, 4, 2, "sword"], [6, 4, 2, "sword"]],
  "理論輸出上限：每方向 1.5 份額 → 總計 ATK × 1.5")]);
checks.push(["4 方向友軍牆＋外圈敵", run("D3  4 方向・第一格全友軍、第二格全敵", 2,
  [[4, 5, 1, "sword"], [4, 6, 2, "sword"], [4, 3, 1, "sword"], [4, 2, 2, "sword"],
   [3, 4, 1, "sword"], [2, 4, 2, "sword"], [5, 4, 1, "sword"], [6, 4, 2, "sword"]],
  "友軍零傷害，四方向各 50% → 總計 ATK × 0.5")]);
checks.push(["混合方向", run("E1  右穿透2敵、上僅第二格、左第一格友軍+第二格敵", 2,
  [[4, 5, 2, "sword"], [4, 6, 2, "sword"], [2, 4, 2, "sword"], [4, 3, 1, "sword"], [4, 2, 2, "sword"]],
  "三個方向 → 每方向份額 ATK/3")]);
checks.push(["互剋：全部打盾", run("F1  2 方向各 1 盾（槍剋盾 +50%）", 2,
  [[4, 5, 2, "shield"], [4, 3, 2, "shield"]], "份額不變，互剋在每個目標各自生效")]);
checks.push(["互剋：混合兵種", run("F2  右穿透 盾+劍、左 1 槍", 2,
  [[4, 5, 2, "shield"], [4, 6, 2, "sword"], [4, 3, 2, "spear"]], "同方向兩個目標各自套用自己的互剋")]);
checks.push(["★1 槍對照", run("G1  ★1 槍・右(4,5)(4,6) 兩敵", 1,
  [[4, 5, 2, "sword"], [4, 6, 2, "sword"]], "★1 無穿透，只打第一格 → 輸出 = ATK")]);
checks.push(["★1 槍・僅第二格", run("G2  ★1 槍・(4,5) 空 (4,6) 敵", 1,
  [[4, 6, 2, "sword"]], "★1 距離2 命中仍為 50%")]);
checks.push(["★1 槍・第一格友軍", run("G3  ★1 槍・(4,5) 友軍 (4,6) 敵", 1,
  [[4, 5, 1, "sword"], [4, 6, 2, "sword"]], "★1 被友軍擋住 → 該方向無目標，0 份")]);

console.log("\n" + "=".repeat(104));
console.log("結構檢查");
console.log("=".repeat(104));
let worst = 0, bad = [];
for (const [name, { res, noCounter, atk }] of checks) {
  const ratio = noCounter / atk;
  worst = Math.max(worst, ratio);
  const perDir = {};
  for (const p of res.packets) perDir[p.dir] = (perDir[p.dir] || 0) + p.base;
  const overDir = Object.values(perDir).some(v => v > res.share * 1.5 + 1e-9);
  const overAll = ratio > 1.5 + 1e-9;
  if (overDir || overAll) bad.push(name);
  console.log("  " + w(name, 26) + w(`方向 ${res.dirs}`, 9)
    + w(`未計互剋輸出 = ATK × ${f(ratio)}`, 28)
    + (overDir ? "✗ 單方向超出 1.5 份額" : "單方向 ≤ 1.5 份額 ✓"));
}
console.log("\n  未計互剋的最大總輸出倍率： ATK × " + f(worst) + (worst <= 1.5 + 1e-9 ? "　（未超過理論上限 1.5）✓" : "　✗ 超出上限"));
console.log("  違反結構限制的情境數： " + bad.length + (bad.length ? " → " + bad.join("、") : " ✓"));
