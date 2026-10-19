import pg from "pg";

const { Pool } = pg;
export const getDatabaseConnectionString = (environment = process.env) => environment.DATABASE_URL || environment.STORAGE_URL;
const pool = new Pool({
  connectionString: getDatabaseConnectionString(),
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});

function query(strings, ...values) {
  if (!getDatabaseConnectionString()) {
    throw Object.assign(new Error("Set DATABASE_URL or STORAGE_URL to your PostgreSQL connection string."), {
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
