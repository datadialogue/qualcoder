/**
 * Runs the app against a throwaway local database filled with dummy data.
 *   npm run dev:local                 start Postgres, seed it the first time, start the app
 *   npm run dev:local -- --reset      wipe the local database and seed it again
 *   npm run dev:local -- -p 3001      anything else is passed on to `next dev`
 *
 * Postgres runs in Docker in a container of its own (`qualcode-local`, port
 * 55434), kept apart from any database you set up by hand so --reset can only
 * ever wipe dummy data. The database URL and session secret are set for this process
 * only, so whatever .env.local points at -- the real database included -- is
 * never read or written. Set LOCAL_DATABASE_URL to use a Postgres you already
 * run instead of Docker; it must be on localhost.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { isLocalUrl } from "../src/lib/env.ts";

const CONTAINER = "qualcode-local";
const HOST_PORT = "55434";
const DEFAULT_URL = `postgres://qualcode:qualcode@localhost:${HOST_PORT}/qualcode`;
const url = process.env.LOCAL_DATABASE_URL || DEFAULT_URL;
const useDocker = !process.env.LOCAL_DATABASE_URL;

function fail(message: string): never {
  console.error(`\n  dev:local: ${message}\n`);
  process.exit(1);
}

if (!isLocalUrl(url)) fail(`LOCAL_DATABASE_URL must point at localhost, not ${url.replace(/\/\/[^@]*@/, "//…@")}.`);

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const nextArgs = args.filter((a) => a !== "--reset");
const portIdx = nextArgs.findIndex((a) => a === "-p" || a === "--port");
const port = portIdx >= 0 ? nextArgs[portIdx + 1] : process.env.PORT || "3000";

// Every child inherits this, and both Next.js and scripts/load-env.ts leave
// variables that are already set alone, so .env.local cannot override them.
const env = {
  ...process.env,
  POSTGRES_URL: url,
  AUTH_SECRET: "local-dev-only-secret",
  QUALCODE_LOCAL: "1",
};
Object.assign(process.env, env);

/* ------------------------------------------------------------------ */
if (useDocker) {
  const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8" });
  if (docker("info").status !== 0) {
    fail(
      "Docker is not running. Start Docker Desktop and try again, or set LOCAL_DATABASE_URL " +
        "to a local Postgres you already run.",
    );
  }
  const state = docker("inspect", "-f", "{{.State.Running}}", CONTAINER);
  if (state.status !== 0) {
    console.log(`Creating local Postgres container "${CONTAINER}" on port ${HOST_PORT} …`);
    const run = docker(
      "run", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_USER=qualcode", "-e", "POSTGRES_PASSWORD=qualcode", "-e", "POSTGRES_DB=qualcode",
      "-p", `${HOST_PORT}:5432`, "postgres:16-alpine",
    );
    if (run.status !== 0) fail(`Could not start Postgres:\n${run.stderr.trim()}`);
  } else if (state.stdout.trim() !== "true") {
    console.log(`Starting local Postgres container "${CONTAINER}" …`);
    const start = docker("start", CONTAINER);
    if (start.status !== 0) fail(`Could not start "${CONTAINER}":\n${start.stderr.trim()}`);
  }
}

// A fresh container restarts once while initialising; wait for the real server.
for (let attempt = 0; ; attempt++) {
  const probe = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    await probe`SELECT 1`;
    await probe.end();
    break;
  } catch (e) {
    await probe.end({ timeout: 0 }).catch(() => {});
    if (attempt >= 45) fail(`Local Postgres at ${url} is not answering: ${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ------------------------------------------------------------------ */
const migrate = spawnSync(
  process.execPath,
  ["--import", "tsx", join("scripts", "migrate.ts"), ...(reset ? ["--reset", "--yes"] : [])],
  { env, stdio: "inherit" },
);
if (migrate.status !== 0) fail("Migrations failed; see above.");

const { sql } = await import("../src/lib/db.ts");
const { ensureLocalPeople, seedLocalFixture, LOCAL_PEOPLE } = await import("./local-fixture.ts");
const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM studies`;
if (n === 0) {
  console.log("Seeding dummy data …");
  await seedLocalFixture(sql);
} else {
  await ensureLocalPeople(sql);
  console.log("Local database already has data; leaving it as it is (--reset starts over).");
}
await sql.end();

console.log("\n  Local data only. Sign in by opening one of these (one person per browser window):");
for (const p of LOCAL_PEOPLE) {
  console.log(`    ${p.name.padEnd(11)} ${p.role.padEnd(6)} http://localhost:${port}/join/${p.token}`);
}
console.log("");

/* ------------------------------------------------------------------ */
const next = spawn(join("node_modules", ".bin", "next"), ["dev", ...nextArgs], { env, stdio: "inherit" });
next.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => next.kill(signal));
}
