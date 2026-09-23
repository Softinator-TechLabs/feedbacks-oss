import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Auth, purgeExpiredPairings } from "../src/server/auth.js";

test("public pairing has a database-wide pending cap and expires old rows", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    await db.query(`
      INSERT INTO pairing(id,secret_hash,name,expires_at)
      SELECT md5(i::text)::uuid, md5((i+1000)::text), 'Test device',
             now()+interval '10 minutes'
      FROM generate_series(1,1000) AS i
    `);
    const auth = new Auth(db);
    await assert.rejects(auth.requestPairing("Another device"), {
      code: "RATE_LIMITED",
    });
    await db.query(
      "UPDATE pairing SET expires_at=now()-interval '1 second' WHERE id=md5('1')::uuid",
    );
    const allowed = await auth.requestPairing("Another device");
    assert.ok(allowed.deviceSecret);
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM pairing")).count,
      1001,
    );
    await purgeExpiredPairings(db);
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM pairing")).count,
      1000,
    );
    await db.query("UPDATE pairing SET expires_at=now()-interval '1 second'");
    await purgeExpiredPairings(db);
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM pairing")).count,
      0,
    );
  } finally {
    await pg.close();
  }
});
