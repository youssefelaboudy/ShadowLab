import { setTimeout as sleep } from "node:timers/promises";
import { startApi } from "../demo-api/server.ts";
import { replay } from "../../packages/core/replay.ts";
import {
  claim,
  heartbeat,
  finish,
  retry,
  migrate,
  initBucket,
  uploadOne,
  db,
} from "../../packages/history/store.ts";
import { flushTraces } from "../../packages/observability/tracing.ts";
export async function processOne() {
  const job = await claim();
  if (!job) return false;
  const pulse = setInterval(
    () => void heartbeat(job.id, job.lease).catch(() => {}),
    9000,
  );
  const targets: Awaited<ReturnType<typeof startApi>>[] = [];
  try {
    const a = await startApi("baseline");
    targets.push(a);
    const b = await startApi(job.candidate);
    targets.push(b);
    const report = await replay(job.definition, a.url, b.url);
    await finish(job.id, job.lease, report);
  } catch {
    await retry(job.id, job.lease);
  } finally {
    clearInterval(pulse);
    await Promise.all(targets.map((s) => s.close()));
  }
  return true;
}
if (import.meta.main) {
  await migrate();
  let storageReady = false;
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  while (!stop) {
    try {
      if (!storageReady) {
        await initBucket();
        storageReady = true;
      }
      const ran = await processOne();
      const uploaded = await uploadOne();
      if (!ran && !uploaded) await sleep(300);
    } catch {
      console.error("Worker dependency unavailable");
      await sleep(1000);
    }
  }
  await flushTraces();
  await db.end();
}
