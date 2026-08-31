import postgres from "postgres";

// postgres.js talks to both a local Docker Postgres and Neon's *pooled*
// endpoint, so dev and production share one code path.
function connect(): postgres.Sql {
  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "POSTGRES_URL is not set. Copy .env.example to .env.local and fill it in " +
        "(local Docker) or paste the pooled connection string from the Neon " +
        "integration (production).",
    );
  }
  const local = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
  return postgres(url, {
    max: 1,
    idle_timeout: 20,
    // Pooled connections run pgbouncer in transaction mode, which cannot
    // support session-level prepared statements.
    prepare: false,
    ssl: local ? false : "require",
  });
}

// Next dev hot-reloads modules; without a global the connection count climbs
// until Postgres refuses new clients.
const g = globalThis as unknown as { __qualcodeSql?: postgres.Sql };
export const sql: postgres.Sql = g.__qualcodeSql ?? connect();
if (process.env.NODE_ENV !== "production") g.__qualcodeSql = sql;

/**
 * postgres.js's JSONValue type is stricter than the interfaces we store in
 * jsonb columns; this keeps those call sites readable without weakening them.
 */
export function json(value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}
