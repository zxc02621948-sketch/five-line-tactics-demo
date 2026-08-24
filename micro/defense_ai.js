// 三種防守策略。能力、兵種選擇、升星邏輯、結算規則全部相同，只有選格評分不同。
const { rnd } = require("./game_harness.js");
const LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inB = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9;

// 現有的基礎評分（A 與 C 共用 dw=0.85，B 用 dw=1.35）
function baseScore(board, r, c, pid, dw) {
  let score = -(Math.abs(r - 4) + Math.abs(c - 4)) * 0.05;
  for (const [dr, dc] of LINE_DIRS) {
    for (let off = -4; off <= 0; off++) {
      let own = 0, enemy = 0, ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * (off + k), cc = c + dc * (off + k);
        if (!inB(rr, cc)) { ok = false; break; }
        const u = board[rr][cc];
        if (u && u.pid === pid) own++; else if (u) enemy++;
      }
      if (!ok || (own && enemy)) continue;
      if (!enemy) score += own * own * 1.15 + (own === 4 ? 500 : 0);
      if (!own) score += dw * (enemy * enemy + (enemy === 4 ? 520 : 0));
    }
  }
  for (const [dr, dc] of DIRS) {
    const u = inB(r + dr, c + dc) && board[r + dr][c + dc];
    if (u) score += u.pid === pid ? 0.25 : 0.4;
  }
  return score;
}

// C 專用：把敵方威脅分層，並辨識自己一手做出雙威脅的格子
function threatLayer(board, r, c, pid) {
  let blockFive = 0;      // 對手下一手可完成五連的關鍵格
  let blockThree = 0;     // 堵掉對手的純三連窗
  let blockTwo = 0;       // 預防性的二連
  let ownFourMakers = 0;  // 這格填下去能讓自己形成四連的窗數

  for (const [dr, dc] of LINE_DIRS) {
    for (let off = -4; off <= 0; off++) {
      const cells = [];
      let ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * (off + k), cc = c + dc * (off + k);
        if (!inB(rr, cc)) { ok = false; break; }
        cells.push([rr, cc]);
      }
      if (!ok || !cells.some(([rr, cc]) => rr === r && cc === c)) continue;
      let own = 0, en = 0;
      for (const [rr, cc] of cells) {
        const u = board[rr][cc];
        if (!u) continue;
        if (u.pid === pid) own++; else en++;
      }
      if (en === 0 && own === 3) ownFourMakers++;
      if (own === 0) {
        if (en === 4) blockFive++;
        else if (en === 3) blockThree++;
        else if (en === 2) blockTwo++;
      }
    }
  }

  // 開放三：敵方連續三顆、兩端都是空格 → 不擋下一手就是無解四連
  let openThreeEnd = 0;
  for (const [dr, dc] of LINE_DIRS) {
    for (const sign of [1, -1]) {
      const hr = r + dr * sign, hc = c + dc * sign;
      let n = 0, rr = hr, cc = hc;
      while (inB(rr, cc) && board[rr][cc] && board[rr][cc].pid !== pid) { n++; rr += dr * sign; cc += dc * sign; }
      if (n !== 3) continue;
      if (inB(rr, cc) && !board[rr][cc]) openThreeEnd++;   // 另一端也空 → 這格是開放三的端點
    }
  }

  let bonus = 0;
  bonus += blockFive * 2000;                       // 1. 對手下一手成五：最高優先
  if (blockFive >= 2) bonus += 2000;               // 2. 一格擋掉兩條 → 對手是雙向必勝威脅
  bonus += openThreeEnd * 150;                     // 3. 開放三的端點
  bonus += blockThree * 35;                        // 3. 一般純三連
  bonus += blockTwo * 4;                           // 5. 普通二連只給低預防權重
  if (ownFourMakers >= 2) bonus += 600;            // 4. 自己一手做出雙威脅
  else if (ownFourMakers === 1) bonus += 150;
  return bonus;
}

function makePicker(mode) {
  return function pick(board, pid) {
    const dw = mode === "B" ? 1.35 : 0.85;
    let best = [], bestScore = -Infinity;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      let s = baseScore(board, r, c, pid, dw);
      if (mode === "C") s += threatLayer(board, r, c, pid);
      if (s > bestScore + 1e-6) { bestScore = s; best = [[r, c]]; }
      else if (Math.abs(s - bestScore) < 1e-6) best.push([r, c]);
    }
    return best.length ? best[Math.floor(rnd() * best.length)] : null;
  };
}

module.exports = {
  A: makePicker("A"),   // 現況
  B: makePicker("B"),   // 只把防守權重提到 1.35
  C: makePicker("C"),   // A + 威脅分層
};
