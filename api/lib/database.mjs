import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});

function query(strings, ...values) {
  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error("Set DATABASE_URL to your PostgreSQL connection string."), {
      status: 503,
      code: "database_not_configured"
    });
  }
  let text = strings[0];
  for (let index = 0; index < values.length; index++) {
    text += `$${index + 1}${strings[index + 1]}`;
  }
  return pool.query(text, values).then(result => result.rows);
}

export const db = { pool, sql: query };
