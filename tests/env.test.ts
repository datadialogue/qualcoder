import test from "node:test";
import assert from "node:assert/strict";
import { isLocalUrl, isPooledUrl, readEnv, readEnvEntry, resolveDatabaseUrl } from "../src/lib/env.ts";

/** Runs `fn` with process.env replaced by exactly `vars`. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const saved = process.env;
  process.env = { ...vars } as NodeJS.ProcessEnv;
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

const NEON_POOLED =
  "postgresql://u:p@ep-example-pooler.c-2.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";
const NEON_DIRECT =
  "postgresql://u:p@ep-example.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://qualcode:qualcode@localhost:55432/qualcode";

test("a bare variable name is found", () => {
  withEnv({ POSTGRES_URL: NEON_POOLED }, () => {
    assert.equal(readEnvEntry("POSTGRES_URL")?.key, "POSTGRES_URL");
    assert.equal(readEnv("POSTGRES_URL"), NEON_POOLED);
  });
});

test("a namespaced variable is found when the bare name is absent", () => {
  // Vercel integrations can prefix everything they inject.
  withEnv({ qual_POSTGRES_URL: NEON_POOLED }, () => {
    const found = readEnvEntry("POSTGRES_URL");
    assert.equal(found?.key, "qual_POSTGRES_URL");
    assert.equal(found?.value, NEON_POOLED);
  });
  withEnv({ qual_AUTH_SECRET: "s3cret" }, () => {
    assert.equal(readEnv("AUTH_SECRET"), "s3cret");
  });
});

test("the bare name wins over a namespaced one", () => {
  withEnv({ POSTGRES_URL: LOCAL, qual_POSTGRES_URL: NEON_POOLED }, () => {
    assert.equal(readEnvEntry("POSTGRES_URL")?.value, LOCAL);
  });
});

test("a near-miss name is not mistaken for the one asked for", () => {
  // POSTGRES_URL_NON_POOLING must never satisfy a request for POSTGRES_URL.
  withEnv({ POSTGRES_URL_NON_POOLING: NEON_DIRECT }, () => {
    assert.equal(readEnvEntry("POSTGRES_URL"), null);
  });
  withEnv({ MY_POSTGRES_URL_NON_POOLING: NEON_DIRECT }, () => {
    assert.equal(readEnvEntry("POSTGRES_URL"), null);
    assert.equal(readEnvEntry("POSTGRES_URL_NON_POOLING")?.value, NEON_DIRECT);
  });
});

test("empty values are treated as absent", () => {
  withEnv({ POSTGRES_URL: "", qual_POSTGRES_URL: NEON_POOLED }, () => {
    assert.equal(readEnvEntry("POSTGRES_URL")?.value, NEON_POOLED);
  });
  withEnv({ AUTH_SECRET: "" }, () => {
    assert.equal(readEnv("AUTH_SECRET"), undefined);
  });
});

test("pooled and direct endpoints are told apart", () => {
  assert.equal(isPooledUrl(NEON_POOLED), true);
  assert.equal(isPooledUrl(NEON_DIRECT), false);
  assert.equal(isPooledUrl("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres"), true);
  assert.equal(isPooledUrl("postgres://u:p@host/db?pgbouncer=true"), true);
});

test("local hosts are recognised so SSL is not demanded of Docker", () => {
  assert.equal(isLocalUrl(LOCAL), true);
  assert.equal(isLocalUrl("postgres://u:p@127.0.0.1:5432/db"), true);
  assert.equal(isLocalUrl(NEON_POOLED), false);
});

test("resolution prefers a pooled URL over a direct one", () => {
  withEnv({ POSTGRES_URL_NON_POOLING: NEON_DIRECT, DATABASE_URL: NEON_POOLED }, () => {
    const r = resolveDatabaseUrl()!;
    assert.equal(r.url, NEON_POOLED);
    assert.equal(r.pooled, true);
  });
});

test("resolution falls back to a direct URL rather than failing", () => {
  withEnv({ DATABASE_URL_UNPOOLED: NEON_DIRECT }, () => {
    const r = resolveDatabaseUrl()!;
    assert.equal(r.url, NEON_DIRECT);
    assert.equal(r.pooled, false);
  });
});

test("a fully namespaced Neon variable set resolves correctly", () => {
  // This mirrors what the Vercel integration injects when a prefix is set.
  withEnv(
    {
      qual_DATABASE_URL: NEON_POOLED,
      qual_DATABASE_URL_UNPOOLED: NEON_DIRECT,
      qual_POSTGRES_URL: NEON_POOLED,
      qual_POSTGRES_URL_NON_POOLING: NEON_DIRECT,
      qual_PGHOST: "ep-example-pooler.c-2.us-east-1.aws.neon.tech",
      qual_AUTH_SECRET: "s3cret",
    },
    () => {
      const r = resolveDatabaseUrl()!;
      assert.equal(r.key, "qual_POSTGRES_URL");
      assert.equal(r.pooled, true);
      assert.equal(r.local, false);
      assert.equal(readEnv("AUTH_SECRET"), "s3cret");
    },
  );
});

test("no connection string at all resolves to null rather than throwing", () => {
  withEnv({ PGHOST: "somewhere" }, () => {
    assert.equal(resolveDatabaseUrl(), null);
  });
});
