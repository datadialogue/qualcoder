/** Loads .env.local then .env into process.env for standalone scripts.
 *  Next.js does this itself for the app; CLI scripts need it explicitly.
 *  Skipped under `npm run dev:local`, which supplies its own local database
 *  and must never pick up the real one from .env.local. */
import { existsSync } from "node:fs";
import { join } from "node:path";

for (const file of process.env.QUALCODE_LOCAL === "1" ? [] : [".env.local", ".env"]) {
  const path = join(process.cwd(), file);
  if (existsSync(path)) process.loadEnvFile(path);
}
