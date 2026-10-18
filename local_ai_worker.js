// 每次思考由自己的 worker 處理，主頁可在重開、棄賽或逾時時直接終止。
importScripts("/game_engine.js?v=20260908", "/local_ai.js?v=1");
self.onmessage = async event => {
  const { jobId, snapshot, budgetMs } = event.data;
  try {
    const plan = await globalThis.FiveLineAI.choose(snapshot, { budgetMs });
    self.postMessage({ jobId, plan });
  } catch {
    self.postMessage({ jobId, error: "planner_unavailable" });
  }
};
