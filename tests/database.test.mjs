import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../api/lib/database.mjs";

test("PostgreSQL tagged queries pass interpolated values as parameters", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const originalQuery = db.pool.query;
  let query;
  process.env.DATABASE_URL = "postgresql://test:secret@example.invalid/factory";
  db.pool.query = async (text, values) => {
    query = { text, values };
    return { rows: [{ value: "ok" }] };
  };

  try {
    const rows = await db.sql`select ${"'; drop table factory_company; --"} as value, ${42}::int as count`;
    assert.deepEqual(query, {
      text: "select $1 as value, $2::int as count",
      values: ["'; drop table factory_company; --", 42]
    });
    assert.deepEqual(rows, [{ value: "ok" }]);
  } finally {
    db.pool.query = originalQuery;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
