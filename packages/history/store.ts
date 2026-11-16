import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { digest, canonical } from "../fixtures/manifest.ts";
import { validate, type Scenario } from "../core/schema.ts";
import type { Report } from "../core/replay.ts";
import { markdown } from "../cli/markdown.ts";
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
});
const bucket = process.env.S3_BUCKET || "shadowlab";
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.AWS_REGION || "us-east-1",
  forcePathStyle: true,
});
async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function migrate() {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(724191)");
    await c.query(sql);
  });
}
export async function initBucket() {
  try {
    await storage.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      await storage.send(new HeadBucketCommand({ Bucket: bucket }));
    }
  }
}
export async function enqueue(scenario: Scenario, candidate: string) {
  const s = validate(scenario);
  if (!["fixed", "stale", "missing", "error"].includes(candidate))
    throw Error("Unknown candidate");
  return transaction(async (c) => {
    const checksum = digest(canonical(s));
    const { rows } = await c.query(
      "INSERT INTO scenarios(name,version,checksum,fixture_id,definition) VALUES($1,$2,$3,$4,$5) ON CONFLICT(name,version) DO UPDATE SET name=excluded.name WHERE scenarios.checksum=excluded.checksum RETURNING id",
      [s.name, s.version, checksum, s.fixture, s],
    );
    if (!rows.length)
      throw Error("Scenario version already exists with different content");
    const sid = rows[0].id;
    for (const [i, step] of s.steps.entries())
      await c.query(
        "INSERT INTO scenario_steps VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [sid, i + 1, step],
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO jobs(id,scenario_id,candidate,priority) SELECT $1,$2::bigint,$3,count(*) FROM (SELECT 1 FROM runs WHERE scenario_id=$2 AND status='REGRESSION' ORDER BY completed_at DESC LIMIT 10) recent",
      [id, sid, candidate],
    );
    return id;
  });
}
export async function claim() {
  const token = randomUUID();
  await db.query(
    "UPDATE jobs SET state='failed',lease=NULL WHERE state='running' AND expires<now() AND attempts>=3",
  );
  const { rows } = await db.query(
    `WITH next AS (SELECT id FROM jobs WHERE state='queued' OR (state='running' AND expires<now() AND attempts<3) ORDER BY priority DESC,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE jobs j SET state='running',attempts=attempts+1,lease=$1,expires=now()+interval '30 seconds' FROM next,scenarios s WHERE j.id=next.id AND j.scenario_id=s.id RETURNING j.id,j.candidate,j.lease,s.definition`,
    [token],
  );
  return rows[0] as
    | {
        id: string;
        lease: string;
        candidate: "fixed" | "stale" | "missing" | "error";
        definition: Scenario;
      }
    | undefined;
}
export async function heartbeat(id: string, lease: string) {
  await db.query(
    "UPDATE jobs SET expires=now()+interval '30 seconds' WHERE id=$1 AND lease=$2 AND state='running'",
    [id, lease],
  );
}
export async function retry(id: string, lease: string) {
  await db.query(
    "UPDATE jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,lease=NULL WHERE id=$1 AND lease=$2",
    [id, lease],
  );
}
export async function finish(id: string, lease: string, r: Report) {
  await transaction(async (c) => {
    const { rows } = await c.query(
      "UPDATE jobs SET state='done',lease=NULL WHERE id=$1 AND lease=$2 AND state='running' RETURNING scenario_id",
      [id, lease],
    );
    if (!rows.length) throw Error("Lost lease");
    await c.query("INSERT INTO runs VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
      id,
      rows[0].scenario_id,
      r.baselineCommit,
      r.candidateCommit,
      r.status,
      r.startedAt,
      r.completedAt,
      r,
    ]);
    for (const s of r.steps) {
      for (const env of ["baseline", "candidate"] as const) {
        const result = s[env];
        await c.query("INSERT INTO step_results VALUES($1,$2,$3,$4,$5,$6)", [
          id,
          s.ordinal,
          env,
          result?.status,
          result?.body,
          r.durations[env][s.ordinal - 1],
        ]);
      }
      for (const d of s.differences)
        await c.query(
          "INSERT INTO diffs(run_id,ordinal,path,reason,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            s.ordinal,
            d.path,
            d.reason,
            JSON.stringify(d.baseline),
            JSON.stringify(d.candidate),
          ],
        );
    }
    for (const [format, content] of [
      ["json", JSON.stringify(r, null, 2)],
      ["md", markdown(r)],
    ]) {
      const hash = digest(content);
      await c.query(
        "INSERT INTO artifacts(run_id,format,object_key,checksum,content) VALUES($1,$2,$3,$4,$5)",
        [id, format, id + "/" + hash + "." + format, hash, content],
      );
    }
  });
}
// The same transaction commits the run and upload outbox. Identical retries use the same object key.
export async function uploadOne() {
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM artifacts WHERE NOT uploaded ORDER BY run_id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    const a = rows[0];
    if (!a) return false;
    await storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: a.object_key,
        Body: a.content,
        Metadata: { sha256: a.checksum },
      }),
    );
    await c.query("UPDATE artifacts SET uploaded=true WHERE object_key=$1", [
      a.object_key,
    ]);
    return true;
  });
}
export async function expire(days: number) {
  if (!Number.isInteger(days) || days < 0) throw Error("Invalid retention");
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT id FROM runs WHERE completed_at<=now()-($1::int * interval '1 day') FOR UPDATE",
      [days],
    );
    for (const { id } of rows) {
      const objects = await c.query(
        "SELECT object_key FROM artifacts WHERE run_id=$1 FOR UPDATE",
        [id],
      );
      for (const a of objects.rows)
        await storage.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: a.object_key }),
        );
      await c.query("DELETE FROM jobs WHERE id=$1", [id]);
    }
    return rows.length;
  });
}
