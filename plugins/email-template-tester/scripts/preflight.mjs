#!/usr/bin/env node
// Setup checks for the email-template-tester plugin. Uses no npm packages, so it still runs when the
// plugin's packages failed to install.
//
// It runs in two ways:
//   1. As the plugin's SessionStart hook (hooks/hooks.json). It stays silent unless the folder is an
//      email project (has pipeline.json) and something is wrong. Then it warns the user and tells Claude.
//   2. Through the email-build server's check_install tool, which the check-setup skill calls.
//
// It only reads. It never changes the user's Claude config: it suggests a fix and the user decides.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ID = "email-template-tester@email-template-tester";
const FIGMA_PACKAGE = "figma-console-mcp";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const realOrSame = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const commandLine = (s) => [s?.command, ...(s?.args || []), s?.url].filter(Boolean).join(" ");

// ---------- 1. Another Figma server ----------
// The plugin brings its own figma-console server. A second one that the user added themselves starts a
// second Figma connection, and Claude sees every Figma tool twice. Claude Code runs a server only once
// when the command is identical, so only a different command (e.g. @latest vs the pinned version) clashes.

function otherFigmaServers(projectDir) {
  const configFile = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json")
    : path.join(homedir(), ".claude.json");
  const config = readJson(configFile) || {};
  const folder = config.projects?.[projectDir] || config.projects?.[realOrSame(projectDir)] || {};
  const turnedOff = new Set([...(folder.disabledMcpServers || []), ...(folder.disabledMcpjsonServers || [])]);
  const ours = commandLine(readJson(path.join(PLUGIN_ROOT, ".mcp.json"))?.mcpServers?.["figma-console"]);

  const found = [];
  const scan = (servers, scope) => {
    for (const [name, server] of Object.entries(servers || {})) {
      const cmd = commandLine(server);
      if (!cmd.includes(FIGMA_PACKAGE) || turnedOff.has(name) || cmd === ours) continue;
      found.push({ name, scope, cmd });
    }
  };
  scan(config.mcpServers, "user");
  scan(folder.mcpServers, "local");
  scan(readJson(path.join(projectDir, ".mcp.json"))?.mcpServers, "project");

  return found.map(({ name, scope, cmd }) => ({
    level: "error",
    check: "figma",
    problem: `A second Figma server, "${name}" (${scope} scope: ${cmd}), will compete with the plugin's own Figma server for the Figma connection.`,
    fix:
      `Choose one. If you only added it for this plugin, remove it: run \`claude mcp remove ${name} -s ${scope}\` in a terminal, then restart Claude Code. ` +
      `If you use it in other projects, keep it and turn it off in this folder only: type /mcp, choose "${name}", then Disable.`,
  }));
}

// ---------- 2. Plugin packages ----------

function missingPackages() {
  const deps = Object.keys(readJson(path.join(PLUGIN_ROOT, "package.json"))?.dependencies || {});
  const missing = deps.filter((d) => !existsSync(path.join(PLUGIN_ROOT, "node_modules", d, "package.json")));
  if (!missing.length) return [];
  return [
    {
      level: "error",
      check: "packages",
      problem: `The plugin's packages are missing (${missing.join(", ")}), so its Klaviyo and build tools can't start.`,
      fix: `Reinstall the plugin: /plugin uninstall ${PLUGIN_ID}, then /plugin install ${PLUGIN_ID}, then restart Claude Code.`,
    },
  ];
}

// ---------- 3. Klaviyo key ----------
// Same order the klaviyo server uses: this project's own key, then the plugin settings.

const parseKey = (raw) => (raw.match(/KLAVIYO_API_KEY\s*=\s*(\S+)/) || raw.match(/^\s*(\S+)\s*$/) || [])[1] || null;
const notPrivateKey = (key) => !key.startsWith("pk_");

function keyProblems(projectDir, settings) {
  const keyName = readJson(path.join(projectDir, "pipeline.json"))?.klaviyo?.keyName;
  if (keyName) {
    const file = path.join(homedir(), ".email-template-tester", "keys", String(keyName));
    const shown = `~/.email-template-tester/keys/${keyName}`;
    if (!/^[A-Za-z0-9_-]+$/.test(String(keyName)) || !existsSync(file)) {
      return [
        {
          level: "error",
          check: "klaviyo-key",
          problem: `This project uses its own Klaviyo key "${keyName}", but ${shown} doesn't exist.`,
          fix: `Save the key with the command under "A brand with its own Klaviyo account" in the plugin README, using the name ${keyName}.`,
        },
      ];
    }
    const out = [];
    const key = parseKey(readFileSync(file, "utf8"));
    if (!key) {
      out.push({ level: "error", check: "klaviyo-key", problem: `${shown} has no key in it.`, fix: "Save the key again with the README command." });
    } else if (notPrivateKey(key)) {
      out.push({
        level: "warning",
        check: "klaviyo-key",
        problem: `The key in ${shown} doesn't start with pk_, so it may not be a Klaviyo private API key.`,
        fix: "In Klaviyo, Settings → API keys, create a private key and save it again.",
      });
    }
    if (statSync(file).mode & 0o077) {
      out.push({
        level: "warning",
        check: "klaviyo-key",
        problem: `${shown} can be read by other users on this computer.`,
        fix: `Run \`chmod 600 ${shown}\` in a terminal.`,
      });
    }
    return out;
  }

  if (!settings) return []; // the check_install tool can't see plugin settings; check_connection covers them
  const key = (settings.klaviyoKey || "").trim();
  if (!key || key.startsWith("${")) {
    if (existsSync(path.join(homedir(), ".klaviyo-api-key"))) return [];
    return [
      {
        level: "error",
        check: "klaviyo-key",
        problem: "No Klaviyo key is set, so Klaviyo uploads, templates and test sends won't work.",
        fix: `Run /plugin configure ${PLUGIN_ID} and paste the key, or give this brand its own key (README).`,
      },
    ];
  }
  if (notPrivateKey(key)) {
    return [
      {
        level: "warning",
        check: "klaviyo-key",
        problem: "The Klaviyo key in the plugin settings doesn't start with pk_, so it may not be a private API key.",
        fix: `Create a private key in Klaviyo (Settings → API keys) and enter it with /plugin configure ${PLUGIN_ID}.`,
      },
    ];
  }
  return [];
}

// ---------- 4. Litmus test address ----------

function litmusProblems(settings) {
  if (!settings) return [];
  const addresses = (settings.litmusAddress || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("${"));
  if (!addresses.length) {
    return [
      {
        level: "warning",
        check: "litmus-address",
        problem: "No Litmus test address is set, so test sends are switched off.",
        fix: `Run /plugin configure ${PLUGIN_ID} and add your ...@litmusemail.com address.`,
      },
    ];
  }
  const other = addresses.filter((a) => !/@litmusemail\.com$/i.test(a));
  if (!other.length) return [];
  return [
    {
      level: "warning",
      check: "litmus-address",
      problem: `${other.join(", ")} ${other.length > 1 ? "aren't Litmus addresses" : "isn't a Litmus address"}, but test emails are allowed to go there.`,
      fix: `If that's not intended, run /plugin configure ${PLUGIN_ID} and keep only your ...@litmusemail.com address.`,
    },
  ];
}

// ---------- entry points ----------

// settings: { klaviyoKey, litmusAddress } when the plugin settings are known (hook), or null (MCP tool).
export function runChecks({ projectDir, settings = null }) {
  return [...missingPackages(), ...otherFigmaServers(projectDir), ...keyProblems(projectDir, settings), ...litmusProblems(settings)];
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 2000).unref();
  });
}

async function sessionStartHook() {
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {}
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());

  // The plugin is on in every folder. Only speak up in email project folders.
  if (!existsSync(path.join(projectDir, "pipeline.json"))) return;

  const problems = runChecks({
    projectDir,
    settings: {
      klaviyoKey: process.env.CLAUDE_PLUGIN_OPTION_KLAVIYO_API_KEY,
      litmusAddress: process.env.CLAUDE_PLUGIN_OPTION_LITMUS_TEST_ADDRESS,
    },
  });
  if (!problems.length) return;

  const lines = problems.map((p) => `- ${p.problem} Fix: ${p.fix}`).join("\n");
  const count = `${problems.length} setup problem${problems.length > 1 ? "s" : ""}`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Email Template Tester found ${count}:\n${problems.map((p) => `• ${p.problem}`).join("\n")}\nAsk Claude to "check the email setup" for the fix.`,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `Email Template Tester setup check (plugin SessionStart hook) found ${count} in this email project:\n${lines}\n` +
          "Tell the user about these before starting email work and give the fix. Don't change their Claude or MCP config yourself; they run the fix.",
      },
    }) + "\n"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realOrSame(process.argv[1])).href) {
  // A failing check must never block a session.
  sessionStartHook()
    .catch(() => {})
    .finally(() => process.exit(0));
}
