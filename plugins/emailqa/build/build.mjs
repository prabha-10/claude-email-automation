// Bundle the EmailQA servers into single files in ../dist, so the installed plugin needs no npm install
// (plugins synced from claude.ai get no node_modules). Run: npm run build (from this folder).

import { build } from "esbuild";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");

const entries = {
  "email-build": "src/email-build.mjs",
  klaviyo: "src/klaviyo.mjs",
  figma: "src/figma-launcher.mjs",
};

// Version in src/lib/common.mjs must match plugin.json, or users won't get updates.
const plugin = JSON.parse(await readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
const common = await readFile(path.join(root, "src", "lib", "common.mjs"), "utf8");
const srcVersion = (common.match(/VERSION = "([^"]+)"/) || [])[1];
if (srcVersion !== plugin.version) {
  console.error(`Version mismatch: plugin.json ${plugin.version}, src/lib/common.mjs ${srcVersion}`);
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(dist, `${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: true,
    keepNames: true,
    legalComments: "eof",
    nodePaths: [path.join(here, "node_modules")],
    external: ["typescript"], // optional loader inside cosmiconfig (mjml config), never used
    // CommonJS dependencies (mjml, juice…) call require(); give the ES module bundle a real one.
    banner: { js: "import { createRequire as __emailqaRequire } from 'node:module'; const require = __emailqaRequire(import.meta.url);" },
    logLevel: "warning",
  });
  const { size } = await stat(path.join(dist, `${name}.mjs`));
  console.log(`dist/${name}.mjs  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`EmailQA ${plugin.version} built.`);
