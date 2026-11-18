import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { createInterface } from "readline";

export const createSimilarityService = (pythonBin) => {
  let worker;
  let ready = false;
  const pending = new Map();
  const metrics = { embeddings: 0, workerFailures: 0, maxPending: 0 };

  const start = () => new Promise((resolve, reject) => {
    let failed = false;
    let stopping = false;
    worker = spawn(pythonBin, ["scripts/similarity_worker.py"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: worker.stdout });
    // Clear every waiting comparison when the Python process cannot continue.
    const failWorker = (error) => {
      if (failed) return;
      failed = true;
      if (!stopping) metrics.workerFailures++;
      clearTimeout(timeout);
      ready = false;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      reject(error);
    };
    const timeout = setTimeout(() => {
      failWorker(new Error("Similarity worker startup timed out"));
      worker.kill("SIGTERM");
    }, 120000);

    lines.on("line", (line) => {
      try {
        const result = JSON.parse(line);
        if (Number.isSafeInteger(result.embeddings) && result.embeddings >= 0) {
          metrics.embeddings += result.embeddings;
        }
        if (result.ready) {
          clearTimeout(timeout);
          ready = true;
          resolve();
          return;
        }
        const request = pending.get(result.id);
        if (!request) return;
        pending.delete(result.id);
        result.error
          ? request.reject(new Error(result.error))
          : request.resolve(result);
      } catch (error) {
        console.error("Invalid similarity worker output", error.message);
      }
    });
    worker.stderr.on("data", (data) =>
      console.error("Similarity worker:", data.toString().trim())
    );
    worker.once("error", failWorker);
    worker.once("exit", (code) => {
      const wasReady = ready;
      failWorker(new Error(wasReady ? "Similarity worker stopped" : `Similarity worker exited with code ${code}`));
    });
    worker.markStopping = () => { stopping = true; };
  });

  const compare = async (text1, text2) => {
    if (!ready) throw new Error("Similarity worker is not ready");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Similarity calculation timed out"));
      }, 15000);
      pending.set(id, {
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      metrics.maxPending = Math.max(metrics.maxPending, pending.size);
      try {
        worker.stdin.write(`${JSON.stringify({ id, text1, text2 })}\n`);
      } catch (error) {
        pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  };

  return {
    start, compare,
    getMetrics: () => ({ ...metrics, pending: pending.size }),
    stop: () => { ready = false; worker?.markStopping(); worker?.kill("SIGTERM"); },
  };
};
