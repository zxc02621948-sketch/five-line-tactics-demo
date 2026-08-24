// 只檢查「槍自己發出的傷害封包」，排除盤面上其他單位的互毆
const { setup } = require("./rank2_concept.js");
const cases = [
  ["A2 1方向2敵（穿透）",  [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,6,2,"sword",1]], [24,12]],
  ["A3 第一格友軍",        [[4,4,1,"spear",2],[4,5,1,"sword",1],[4,6,2,"sword",1]], [12]],
  ["A4 僅第二格有敵",      [[4,4,1,"spear",2],[4,6,2,"sword",1]], [12]],
  ["B1 2方向各1敵",        [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,3,2,"sword",1]], [12,12]],
  ["B2 2方向・一邊穿透",   [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,6,2,"sword",1],[4,3,2,"sword",1]], [12,12,6]],
  ["C1 3方向各1敵",        [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,3,2,"sword",1],[3,4,2,"sword",1]], [8,8,8]],
  ["D1 4方向各1敵",        [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,3,2,"sword",1],[3,4,2,"sword",1],[5,4,2,"sword",1]], [6,6,6,6]],
  ["D2 4方向各2敵",        [[4,4,1,"spear",2],[4,5,2,"sword",1],[4,6,2,"sword",1],[4,3,2,"sword",1],[4,2,2,"sword",1],
                            [3,4,2,"sword",1],[2,4,2,"sword",1],[5,4,2,"sword",1],[6,4,2,"sword",1]], [6,6,6,6,3,3,3,3]],
  ["D3 四方向友軍牆",      [[4,4,1,"spear",2],[4,5,1,"sword",1],[4,6,2,"sword",1],[4,3,1,"sword",1],[4,2,2,"sword",1],
                            [3,4,1,"sword",1],[2,4,2,"sword",1],[5,4,1,"sword",1],[6,4,2,"sword",1]], [3,3,3,3]],
  ["F1 互剋・2方向各1盾",  [[4,4,1,"spear",2],[4,5,2,"shield",1],[4,3,2,"shield",1]], [18,18]],
  ["G1 ★1槍・2敵直線",    [[4,4,1,"spear",1],[4,5,2,"sword",1],[4,6,2,"sword",1]], [24]],
  ["G2 ★1槍・僅第二格",   [[4,4,1,"spear",1],[4,6,2,"sword",1]], [12]],
  ["G3 ★1槍・第一格友軍", [[4,4,1,"spear",1],[4,5,1,"sword",1],[4,6,2,"sword",1]], []],
];
let fail = 0;
for (const [label, spec, expect] of cases) {
  const e = setup(spec, 0.33);
  const spearId = e.board[4][4].id;
  const res = e.resolveCombat();          // 內部已自行套用並還原 patchSpearSplit
  const got = res.packets.filter(p => p.from.unitId === spearId)
    .map(p => Math.round(p.amount * 100) / 100).sort((a, b) => b - a);
  const exp = [...expect].sort((a, b) => b - a);
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fail++;
  const friendly = res.packets.some(p => p.from.unitId === spearId && p.to.pid === 1);
  console.log(`${label.padEnd(24)} 槍發出 [${got}]  預期 [${exp}]  ${ok ? "✓" : "✗"}${friendly ? "  ✗ 打到友軍" : ""}`
    + `  總輸出 ${got.reduce((s,v)=>s+v,0)}`);
}
console.log(`\n不符 ${fail} 件`);
