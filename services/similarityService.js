import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { createInterface } from "readline";

export const createSimilarityService = (pythonBin) => {
  let worker;
  let ready = false;
  const pending = new Map();

  const start = () => new Promise((resolve, reject) => {
    worker = spawn(pythonBin, ["scripts/similarity_worker.py"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: worker.stdout });
    const timeout = setTimeout(
      () => reject(new Error("Similarity worker startup timed out")),
      120000
    );

    lines.on("line", (line) => {
      try {
        const result = JSON.parse(line);
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
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("exit", (code) => {
      for (const request of pending.values()) {
        request.reject(new Error("Similarity worker stopped"));
      }
      pending.clear();
      if (code && !ready) reject(new Error(`Similarity worker exited with code ${code}`));
    });
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
      worker.stdin.write(`${JSON.stringify({ id, text1, text2 })}\n`);
    });
  };

  return { start, compare, stop: () => worker?.kill("SIGTERM") };
};
