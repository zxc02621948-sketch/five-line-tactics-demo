const { playGame } = require("./game_harness.js");
const t0 = Date.now();
for (let i = 0; i < 20; i++) playGame(1.0, 1.0, 7 * (i + 1), 1);
console.log("20 局耗時", Date.now() - t0, "ms");
const r = playGame(1.0, 1.0, 999, 1);
console.log("冒煙 winner", r.winner, "rounds", r.rounds, "gameOver", r.gameOver);
console.log("P1 ★★出場", JSON.stringify(r.S[0].r2ByType), " 被唯一限制擋下", JSON.stringify(r.S[0].blockedByUnique));
console.log("P1 有資格但選一星", r.S[0].eligibleChoseOne, " 場上★★平均", (r.S[0].r2OnBoardSum / r.S[0].r2Samples).toFixed(2));
console.log("P1 斬入", r.S[0].cleaves, " 低牌計數", JSON.stringify(r.S[0].lowAvail), " ★★死亡→再備妥", JSON.stringify(r.S[0].r2DeathToReady));
