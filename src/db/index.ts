import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Drizzle ORM client — server-only database access.
 *
 * Uses Neon serverless Postgres over HTTP. The connection string comes from
 * `DATABASE_URL` env var. Returns a configured Drizzle instance with all
 * table schemas for type-safe queries.
 *
 * Usage (inside `createServerFn()` or `src/routes/api/*` routes only):
 *
 *   import { db } from "@/db";
 *   const workspaces = await db.query.workspaces.findMany();
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database before running queries."
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

// Convenience: pre-connected instance (reuses the same HTTP connection pool)
let _db: ReturnType<typeof getDb> | null = null;
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    if (!_db) _db = getDb();
    return Reflect.get(_db, prop);
  },
});
