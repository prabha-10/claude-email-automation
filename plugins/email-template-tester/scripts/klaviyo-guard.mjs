#!/usr/bin/env node
// Browser guard for the email-template-tester plugin (a PreToolUse hook, see hooks/hooks.json).
//
// The client's Klaviyo has no API key here: Claude works in it through the handler's logged-in browser,
// with all of that login's permissions. This hook is a code-level fence around that, active only in email
// project folders (those with pipeline.json):
//
//   1. Claude's browser may open only the Klaviyo app pages the handoff uses: sign-in, API keys (to read
//      the public key), Media & brand images, saved templates, and the template editor. Any other
//      klaviyo.com app page (campaigns, flows, lists, profiles, billing, other settings...) is blocked.
//   2. Browser JavaScript may only read pages: no navigating, clicking, submitting, setting form values or
//      sending non-GET requests from scripts, on any site.
//
// It can't see what a mouse click on an allowed page leads to; the skills' rules cover clicks.
// Uses no npm packages. Exit code 2 blocks the tool call and shows the reason to Claude.

import { existsSync } from "node:fs";
import path from "node:path";

const KLAVIYO_APP_HOSTS = new Set(["klaviyo.com", "www.klaviyo.com"]);

const ALLOWED_KLAVIYO_PATHS = [
  [/^\/login\/?$/, "sign-in"],
  [/^\/settings\/account\/api-keys\/?$/, "Settings → API keys (public key only)"],
  [/^\/brand-library\/images\/?$/, "Media & brand → Images"],
  [/^\/templates\/list\/?$/, "Templates → Email: saved"],
  [/^\/email-editor\/[A-Za-z0-9]+\/edit\/?$/, "the template editor, to check an imported template"],
];

// Scripts that change a page or send something, rather than read it.
const WRITING_JS = [
  [/\b(?:window\.|document\.)?location\s*=(?!=)/, "changes the page address"],
  [/\blocation\.href\s*=(?!=)/, "changes the page address"],
  [/\blocation\.(?:assign|replace|reload)\s*\(/, "changes the page address"],
  [/\bwindow\.open\s*\(/, "opens a window"],
  [/\bhistory\.(?:pushState|replaceState|back|forward|go)\s*\(/, "changes the page address"],
  [/\.click\s*\(/, "clicks an element"],
  [/\.(?:submit|requestSubmit)\s*\(/, "submits a form"],
  [/\bdispatchEvent\s*\(/, "fires page events"],
  [/\.(?:value|checked|selected|innerHTML|outerHTML|textContent|innerText)\s*=(?!=)/, "changes page content or form values"],
  [/\bmethod\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)\b/i, "sends a non-GET request"],
  [/\bnew\s+XMLHttpRequest\b|\bnavigator\.sendBeacon\s*\(/, "sends a request"],
];

const ALLOWED_LIST = ALLOWED_KLAVIYO_PATHS.map(([, label]) => label).join("; ");

/** Every string under a "url" key, anywhere in the tool input (covers navigate, preview_start and batches). */
function urlsIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => urlsIn(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "url" && typeof v === "string") out.push(v);
      else urlsIn(v, out);
    }
  }
  return out;
}

/** Scripts to run: the tool's own text for a JavaScript tool, or JavaScript items inside a batch. */
function scriptsIn(toolName, input) {
  const scripts = [];
  if (/javascript/i.test(toolName) && typeof input?.text === "string") scripts.push(input.text);
  for (const item of Array.isArray(input?.actions) ? input.actions : []) {
    if (/javascript/i.test(item?.name || "") && typeof item?.input?.text === "string") scripts.push(item.input.text);
  }
  return scripts;
}

/** Returns a reason to block, or null to allow. */
export function check(toolName, input) {
  for (const raw of urlsIn(input)) {
    const s = raw.trim();
    if (!s || s === "back" || s === "forward") continue;
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || !KLAVIYO_APP_HOSTS.has(url.hostname.toLowerCase())) continue;
    if (ALLOWED_KLAVIYO_PATHS.some(([re]) => re.test(url.pathname))) continue;
    return (
      `Blocked by the email-template-tester Klaviyo guard: ${url.origin}${url.pathname} isn't one of the Klaviyo pages the handoff uses (${ALLOWED_LIST}). ` +
      "In email project folders Claude's browser can't open other Klaviyo pages, so it can't reach campaigns, flows, lists, profiles, billing or other settings. " +
      "If the user needs that page, they open it themselves."
    );
  }
  for (const script of scriptsIn(toolName, input)) {
    const hit = WRITING_JS.find(([re]) => re.test(script));
    if (hit) {
      return (
        `Blocked by the email-template-tester browser guard: this script ${hit[1]}. ` +
        "In email project folders, browser JavaScript may only read pages. Use find and click for the steps the skills describe, and ask the user before any change."
      );
    }
  }
  return null;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    // Can't read the call. Fail closed only when it might touch Klaviyo.
    if (/klaviyo\.com/i.test(raw)) {
      process.stderr.write("Blocked by the email-template-tester Klaviyo guard: it couldn't read this browser call, so it was stopped to be safe.\n");
      return 2;
    }
    return 0;
  }
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  // The plugin is on in every folder. The guard applies only in email project folders.
  if (!existsSync(path.join(projectDir, "pipeline.json"))) return 0;
  const reason = check(input.tool_name || "", input.tool_input || {});
  if (!reason) return 0;
  process.stderr.write(reason + "\n");
  return 2;
}

if (process.argv[1] && /klaviyo-guard\.mjs$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    () => process.exit(0)
  );
}
