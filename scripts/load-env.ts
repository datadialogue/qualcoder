/** Loads .env.local then .env into process.env for standalone scripts.
 *  Next.js does this itself for the app; CLI scripts need it explicitly. */
import { existsSync } from "node:fs";
import { join } from "node:path";

for (const file of [".env.local", ".env"]) {
  const path = join(process.cwd(), file);
  if (existsSync(path)) process.loadEnvFile(path);
}
