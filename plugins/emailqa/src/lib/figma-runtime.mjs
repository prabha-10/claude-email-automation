// The Figma server (figma-console-mcp) is installed once per computer into the plugin's data folder,
// from the lockfile shipped in figma-runtime/, and started with Node directly (no npx, no .cmd shims).

import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { dataDir, pluginRoot } from "./workspace.mjs";

export const FIGMA_PACKAGE = "figma-console-mcp";

export const runtimeDir = () => path.join(dataDir(), "figma-runtime");
export const figmaEntry = () => path.join(runtimeDir(), "node_modules", FIGMA_PACKAGE, "dist", "local.js");
export const bridgeManifest = () => path.join(homedir(), ".figma-console-mcp", "plugin", "manifest.json");

const readJsonSync = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

export function expectedFigmaVersion() {
  return readJsonSync(path.join(pluginRoot(), "figma-runtime", "package.json"))?.dependencies?.[FIGMA_PACKAGE] || null;
}

export function installedFigmaVersion() {
  if (!existsSync(figmaEntry())) return null;
  return readJsonSync(path.join(runtimeDir(), "node_modules", FIGMA_PACKAGE, "package.json"))?.version || null;
}

export function figmaRuntimeStatus() {
  const expected = expectedFigmaVersion();
  const installed = installedFigmaVersion();
  return { expected, installed, ok: !!installed && installed === expected, folder: runtimeDir() };
}

// npm ships next to node: <node dir>/node_modules/npm (Windows) or <prefix>/lib/node_modules/npm (macOS, Linux).
export function findNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((c) => existsSync(c)) || null;
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, { ...opts, windowsHide: true });
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), opts.timeoutMs || 300000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: out + String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

export async function installFigmaRuntime() {
  const src = path.join(pluginRoot(), "figma-runtime");
  const dir = runtimeDir();
  await mkdir(dir, { recursive: true });
  await copyFile(path.join(src, "package.json"), path.join(dir, "package.json"));
  await copyFile(path.join(src, "package-lock.json"), path.join(dir, "package-lock.json"));
  const npmArgs = ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error", "--cache", path.join(dataDir(), "npm-cache")];
  const npmCli = findNpmCli();
  const result = npmCli
    ? await run(process.execPath, [npmCli, ...npmArgs], { cwd: dir })
    : await run(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { cwd: dir, shell: process.platform === "win32" });
  const status = figmaRuntimeStatus();
  if (result.code !== 0 || !status.ok) {
    const tail = result.out.trim().split("\n").slice(-15).join("\n");
    throw new Error(
      `Installing the Figma server failed (npm exit ${result.code}). Check the internet connection and try again.\n${tail}`
    );
  }
  return status;
}

// Creates ~/.figma-console-mcp/plugin/manifest.json without starting a server.
export async function prepareBridgeManifest() {
  if (!existsSync(figmaEntry())) throw new Error("The Figma server isn't installed yet. Run install_figma_server first.");
  const r = await run(process.execPath, [figmaEntry(), "--print-path"], { cwd: runtimeDir(), timeoutMs: 30000 });
  const manifest = bridgeManifest();
  if (!existsSync(manifest)) {
    throw new Error(`The Figma bridge plugin files weren't created (exit ${r.code}).\n${r.out.trim().slice(-800)}`);
  }
  return manifest;
}
