import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = `${__dirname}/..`;
const cliPackagePath = `${rootDir}/cli/package.json`;
const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf8"));
const cliVersion =
  typeof cliPackage.version === "string" ? cliPackage.version : "0.0.0";

await build({
  entryPoints: [`${rootDir}/cli/src/index.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  sourcemap: false,
  minify: true,
  outfile: `${rootDir}/public/ibx`,
});

chmodSync(`${rootDir}/public/ibx`, 0o755);
writeFileSync(
  `${rootDir}/public/ibx-version.json`,
  `${JSON.stringify(
    {
      name: "@ibx/cli",
      version: cliVersion,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write("built public/ibx\n");
