/**
 * Environment lookup that tolerates namespaced variables.
 *
 * Vercel's marketplace integrations can prefix every variable they inject, so
 * the same value may arrive as `POSTGRES_URL` locally and `qual_POSTGRES_URL`
 * in production. Rather than hard-coding one spelling, look for the bare name
 * first and then for any key ending in `_<NAME>`.
 */

export interface EnvEntry {
  /** The variable name actually found, useful in error messages. */
  key: string;
  value: string;
}

export function readEnvEntry(name: string): EnvEntry | null {
  const exact = process.env[name];
  if (exact) return { key: name, value: exact };

  const suffix = `_${name}`;
  // Sorted so the choice is stable when more than one prefix is present.
  for (const key of Object.keys(process.env).sort()) {
    const value = process.env[key];
    if (value && key !== name && key.endsWith(suffix)) return { key, value };
  }
  return null;
}

export function readEnv(name: string): string | undefined {
  return readEnvEntry(name)?.value ?? undefined;
}

/** Every name we accept for a connection string, most preferred first. */
const POOLED_URL_NAMES = ["POSTGRES_URL", "DATABASE_URL"] as const;
const DIRECT_URL_NAMES = ["POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"] as const;

/**
 * Neon, Supabase and pgbouncer all mark pooled endpoints in the host or query
 * string. Serverless functions open many short-lived connections, so a pooled
 * endpoint is what you want in production; a direct one runs out of slots.
 */
export function isPooledUrl(url: string): boolean {
  return /-pooler\.|pooler\.supabase\.com|pgbouncer=true/.test(url);
}

export function isLocalUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|host\.docker\.internal|\[::1\])[:/]/.test(url);
}

export interface ResolvedDatabase {
  key: string;
  url: string;
  pooled: boolean;
  local: boolean;
}

/**
 * Picks the connection string to use. Prefers a pooled endpoint and falls back
 * to a direct one, so a project that only exposes the unpooled URL still runs.
 */
export function resolveDatabaseUrl(): ResolvedDatabase | null {
  for (const name of POOLED_URL_NAMES) {
    const found = readEnvEntry(name);
    if (found) {
      return {
        key: found.key,
        url: found.value,
        pooled: isPooledUrl(found.value),
        local: isLocalUrl(found.value),
      };
    }
  }
  for (const name of DIRECT_URL_NAMES) {
    const found = readEnvEntry(name);
    if (found) {
      return { key: found.key, url: found.value, pooled: false, local: isLocalUrl(found.value) };
    }
  }
  return null;
}

export const DATABASE_URL_NAMES = [...POOLED_URL_NAMES, ...DIRECT_URL_NAMES];

/**
 * Configuration faults worth reporting on screen. A deployment missing one of
 * these fails in ways that are hard to read from a stack trace, so the app
 * surfaces them directly instead.
 */
export function configProblems(): string[] {
  const problems: string[] = [];

  const db = resolveDatabaseUrl();
  if (!db) {
    problems.push(
      `No database connection string. Set one of ${DATABASE_URL_NAMES.join(", ")} — ` +
        "a namespaced form such as `qual_POSTGRES_URL` also works. On Vercel, add the " +
        "Neon integration, then redeploy so the variables reach the running app.",
    );
  } else if (!db.local && !db.pooled) {
    problems.push(
      `${db.key} points at a direct (unpooled) endpoint. Use the pooled connection ` +
        "string instead — its host contains `-pooler` — or serverless functions will " +
        "exhaust the connection limit.",
    );
  }

  if (!readEnv("AUTH_SECRET")) {
    problems.push(
      "AUTH_SECRET is not set, so invite links cannot create a session. Generate one " +
        "with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"` " +
        "and add it to the project's environment variables (`qual_AUTH_SECRET` is fine).",
    );
  }

  return problems;
}
