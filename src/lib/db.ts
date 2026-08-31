import postgres from "postgres";
import { DATABASE_URL_NAMES, isLocalUrl, resolveDatabaseUrl } from "./env";

// postgres.js talks to both a local Docker Postgres and a hosted pooled
// endpoint, so dev and production share one code path.
function connect(): postgres.Sql {
  const resolved = resolveDatabaseUrl();
  if (!resolved) {
    throw new Error(
      "No database connection string found. Set one of " +
        `${DATABASE_URL_NAMES.join(", ")} (a namespaced form such as ` +
        "`qual_POSTGRES_URL` is also accepted). Locally, copy .env.example to " +
        ".env.local; on Vercel, add the Neon integration and redeploy so the " +
        "variables reach the running app.",
    );
  }

  if (!resolved.local && !resolved.pooled) {
    // Not fatal -- it works, and at this scale it will probably keep working --
    // but the direct endpoint is the wrong one to hand to serverless functions.
    console.warn(
      `[db] ${resolved.key} points at a direct (unpooled) endpoint. On serverless ` +
        "hosting prefer the pooled connection string, whose host contains `-pooler`.",
    );
  }

  return postgres(resolved.url, {
    max: 1,
    idle_timeout: 20,
    // Pooled connections run pgbouncer in transaction mode, which cannot
    // support session-level prepared statements.
    prepare: false,
    // `true` verifies the certificate; hosted Postgres presents a valid one.
    // Unencrypted local Docker has no certificate to verify.
    ssl: resolved.local ? false : true,
  });
}

// Next dev hot-reloads modules; without a global the connection count climbs
// until Postgres refuses new clients.
const g = globalThis as unknown as { __qualcodeSql?: postgres.Sql };
export const sql: postgres.Sql = g.__qualcodeSql ?? connect();
if (process.env.NODE_ENV !== "production") g.__qualcodeSql = sql;

/** Where the current connection points, with credentials removed. Used by the
 *  setup screens so a misconfigured deployment says so plainly. */
export function describeConnection(): string {
  const resolved = resolveDatabaseUrl();
  if (!resolved) return "not configured";
  const host = resolved.url.replace(/^[^:]+:\/\/[^@]*@/, "").split(/[/?]/)[0];
  const kind = resolved.local ? "local" : resolved.pooled ? "pooled" : "direct";
  return `${host} (${kind}, via ${resolved.key})`;
}

export { isLocalUrl };

/**
 * postgres.js's JSONValue type is stricter than the interfaces we store in
 * jsonb columns; this keeps those call sites readable without weakening them.
 */
export function json(value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}
