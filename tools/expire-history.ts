import { db, expire } from "../packages/history/store.ts";
try {
  console.log((await expire(Number(process.argv[2] ?? 14))) + " runs removed");
} finally {
  await db.end();
}
