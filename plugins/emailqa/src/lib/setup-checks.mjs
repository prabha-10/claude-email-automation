// Read-only checks for /emailqa:start setup. Each check returns { id, ok, detail, fix? }.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { VERSION } from "./common.mjs";
import { claudeDir, dataDir, findWorkspace, litmusBases, pluginRoot, readMachine, sessionFolder } from "./workspace.mjs";
import { bridgeManifest, figmaRuntimeStatus, FIGMA_PACKAGE } from "./figma-runtime.mjs";

const NAMES = new Set(["emailqa", "email-template-tester"]);

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const commandLine = (s) => [s?.command, ...(s?.args || []), s?.url].filter(Boolean).join(" ");

function nodeCheck() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    id: "node",
    ok: major >= 18,
    detail: `Node ${process.version} (${process.execPath})`,
    ...(major < 18 && { fix: "Install Node.js 20 LTS or newer from https://nodejs.org, then quit and reopen Claude." }),
  };
}

// Other installed copies of this plugin (or the old email-template-tester) besides the running one.
function duplicateCopies() {
  const ours = real(pluginRoot());
  const found = [];
  const installed = readJson(path.join(claudeDir(), "plugins", "installed_plugins.json"))?.plugins || {};
  for (const [id, entries] of Object.entries(installed)) {
    const name = id.split("@")[0];
    if (!NAMES.has(name)) continue;
    for (const e of entries || []) {
      if (e.installPath && real(e.installPath) === ours) continue;
      found.push({
        what: `${id} (installed from the terminal or the Code tab's plugin browser, ${e.scope || "user"} scope)`,
        fix: `In a terminal: claude plugin uninstall ${id}${e.scope && e.scope !== "user" ? ` --scope ${e.scope}` : ""}`,
      });
    }
  }
  const synced = path.join(claudeDir(), "plugins", "synced");
  if (existsSync(synced)) {
    for (const account of readdirSync(synced, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const name of NAMES) {
        const p = path.join(synced, account.name, name);
        if (existsSync(path.join(p, ".claude-plugin", "plugin.json")) && real(p) !== ours) {
          found.push({
            what: `${name} synced from claude.ai (${p})`,
            fix:
              name === "email-template-tester"
                ? "Remove the old Email Template Tester plugin in the Claude app: Customize → Plugins → … → Remove."
                : "Keep one copy: remove the other EmailQA copy (terminal install or Customize).",
          });
        }
      }
    }
  }
  return {
    id: "duplicates",
    ok: found.length === 0,
    detail: found.length ? found.map((f) => f.what).join("; ") : "Only this copy of EmailQA is installed.",
    ...(found.length && {
      fix: `Two copies start two sets of servers (including two Figma servers). ${found.map((f) => f.fix).join(" ")} Then restart Claude.`,
    }),
  };
}

// A Figma server the user added themselves competes with ours for the bridge and duplicates every Figma tool.
function otherFigmaServers(workspace) {
  const configFile = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(homedir(), ".claude.json");
  const config = readJson(configFile) || {};
  const found = [];
  const scan = (servers, scope, folder) => {
    const off = new Set([...(folder?.disabledMcpServers || []), ...(folder?.disabledMcpjsonServers || [])]);
    for (const [name, s] of Object.entries(servers || {})) {
      if (commandLine(s).includes(FIGMA_PACKAGE) && !off.has(name)) found.push({ name, scope });
    }
  };
  scan(config.mcpServers, "user");
  for (const folder of [sessionFolder(), workspace].filter(Boolean)) {
    const entry = config.projects?.[folder] || config.projects?.[real(folder)];
    scan(entry?.mcpServers, "local", entry);
    scan(readJson(path.join(folder, ".mcp.json"))?.mcpServers, "project", entry);
  }
  const unique = [...new Map(found.map((f) => [`${f.name}/${f.scope}`, f])).values()];
  return {
    id: "figma-other-servers",
    ok: unique.length === 0,
    detail: unique.length ? `Also configured: ${unique.map((f) => `"${f.name}" (${f.scope} scope)`).join(", ")}` : "No other Figma server configured.",
    ...(unique.length && {
      fix:
        `EmailQA brings its own Figma server. ` +
        unique.map((f) => `Remove "${f.name}": claude mcp remove ${f.name} -s ${f.scope}`).join(". ") +
        `. If you need it elsewhere, keep it and switch it off for this folder with /mcp → ${unique[0].name} → Disable. Then restart Claude.`,
    }),
  };
}

function figmaServerCheck() {
  const s = figmaRuntimeStatus();
  return {
    id: "figma-server",
    ok: s.ok,
    detail: s.installed ? `figma-console-mcp ${s.installed} installed (wanted ${s.expected})` : `Not installed yet (wanted ${s.expected})`,
    ...(!s.ok && { fix: "Call install_figma_server, then start a new Claude session so the Figma tools load." }),
  };
}

function bridgeCheck() {
  const m = bridgeManifest();
  const ok = existsSync(m);
  return {
    id: "figma-bridge-files",
    ok,
    detail: ok ? `Bridge plugin manifest: ${m}` : "Bridge plugin files not created yet",
    ...(!ok && { fix: "Call prepare_figma_bridge (after the Figma server is installed)." }),
  };
}

function litmusCheck() {
  const bases = litmusBases();
  const notLitmus = bases.filter((b) => !b.endsWith("@litmusemail.com"));
  return {
    id: "litmus-address",
    ok: bases.length > 0 && notLitmus.length === 0,
    detail: bases.length ? `Test sends allowed to: ${bases.join(", ")} (and their +folder variants)` : "No Litmus test address set",
    ...(bases.length === 0 && {
      fix: "Add your ...@litmusemail.com address in the EmailQA plugin settings (Customize → Plugins → EmailQA → settings, or /plugin configure in the terminal), then start a new session.",
    }),
    ...(notLitmus.length > 0 && { fix: `${notLitmus.join(", ")} is not a Litmus address. Keep only your ...@litmusemail.com address in the plugin settings.` }),
  };
}

export async function runSetupChecks() {
  const workspace = await findWorkspace();
  const machine = await readMachine();
  const checks = [nodeCheck(), duplicateCopies(), otherFigmaServers(workspace), figmaServerCheck(), bridgeCheck(), litmusCheck()];
  checks.push({
    id: "workspace",
    ok: !!workspace,
    detail: workspace ? `Workspace: ${workspace}` : "No workspace yet",
    ...(!workspace && { fix: "Call create_workspace with no path: it makes this session's folder the workspace. Do not ask the user first." }),
  });
  return {
    emailqa_version: VERSION,
    os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform,
    plugin_folder: pluginRoot(),
    data_folder: dataDir(),
    session_folder: sessionFolder(),
    session_is_workspace: !!workspace && real(sessionFolder()) === real(workspace),
    setup_done_on_this_computer: !!machine.setupDone,
    setup_done_version: machine.setupVersion || null,
    all_ok: checks.every((c) => c.ok),
    checks,
    not_checked_here:
      "Klaviyo key (klaviyo server: check_connection), Figma bridge connection (figma_get_status with probe), Litmus login in Chrome (Claude in Chrome).",
  };
}
