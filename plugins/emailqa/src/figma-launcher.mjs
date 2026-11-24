#!/usr/bin/env node
// Starts the Figma server (figma-console-mcp) that /emailqa:start installed into the plugin's data folder,
// with this same Node binary: no npx, no .cmd shims, identical on macOS and Windows.
// If it isn't installed yet, serves a one-tool placeholder that explains how to install it.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { figmaEntry, figmaRuntimeStatus, runtimeDir } from "./lib/figma-runtime.mjs";

const entry = figmaEntry();

if (existsSync(entry)) {
  const child = spawn(process.execPath, [entry], { stdio: "inherit", cwd: runtimeDir(), env: process.env, windowsHide: true });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      try {
        child.kill(sig);
      } catch {}
    });
  }
  child.on("error", (e) => {
    process.stderr.write(`EmailQA: couldn't start the Figma server: ${e.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = new McpServer({ name: "figma", version: "not-installed" });
  const status = figmaRuntimeStatus();
  const message =
    "The Figma server isn't installed on this computer yet. Run /emailqa:start: its setup calls install_figma_server " +
    "(needs internet once), then start a new Claude session so the Figma tools load.";
  server.registerTool(
    "figma_get_status",
    { description: "Placeholder until the Figma server is installed: explains how to install it.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ installed: false, wanted: status.expected, folder: status.folder, message }, null, 2) }] })
  );
  await server.connect(new StdioServerTransport());
}
