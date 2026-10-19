import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
for (const envFile of [".env.production.local", ".env"]) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running database migrations.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
const migrationsDirectory = join(process.cwd(), "database", "migrations");

try {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists factory_schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const migrations = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => /^\d{4}_[a-z0-9_]+$/.test(name))
      .sort();

    for (const name of migrations) {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock(384238, 2)");
        const applied = await client.query("select 1 from factory_schema_migrations where name = $1", [name]);
        if (applied.rowCount) {
          await client.query("commit");
          continue;
        }
        const migration = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
        await client.query(migration);
        await client.query("insert into factory_schema_migrations(name) values($1)", [name]);
        await client.query("commit");
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
