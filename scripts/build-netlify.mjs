import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("drizzle/", root))
  .filter(name => name.endsWith(".sql")).sort()
  .map(name => ({ name, sql: readFileSync(new URL(`drizzle/${name}`, root), "utf8") }));
writeFileSync(new URL("lib/netlify/migrations.json", root), JSON.stringify(migrations, null, 2) + "\n");
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("node_modules/next/dist/bin/next", root)),
  "build", "--webpack",
], { cwd: fileURLToPath(root), stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
