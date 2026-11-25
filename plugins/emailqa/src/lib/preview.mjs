// Local preview server: serves the workspace's clients/ folder read-only on 127.0.0.1, plus a compare page
// that shows an email at 600px, at 375px (mobile breakpoint) and once per client dark mode (dark-sim.mjs).
// Chrome can't open file:// pages for Claude, so this replaces ad-hoc localhost servers.
// An .html file with ?dark=<mode id> is served through simulateDark; ?dark=1 is the Gmail App Android mode.

import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { isInside } from "./workspace.mjs";
import { DARK_MODES, simulateDark } from "./dark-sim.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".css": "text/css",
  ".json": "application/json",
};

// ?dark=1 (the old single dark view) maps to the Gmail App Android approximation.
const LEGACY_DARK = "gmail-android";
const darkKey = (id) => `dark_${id.replace(/-/g, "_")}`;

let state = null; // { server, port, root }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function comparePage(src, title) {
  const frame = (label, w, mode, note) =>
    `<figure style="width:${w}px"><figcaption>${esc(label)}</figcaption>${note ? `<p class="note">${esc(note)}</p>` : ""}` +
    `<iframe src="${esc(src)}${mode ? `?dark=${encodeURIComponent(mode)}` : ""}" style="width:${w}px" title="${esc(label)}"></iframe></figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · EmailQA preview</title>
<style>:root{color-scheme:light}body{margin:0;padding:16px;background:#e9e9ec;font:13px system-ui,sans-serif;color:#222}
.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}
figcaption{margin:0 0 6px;font-weight:600}.note{margin:0 0 8px;color:#555;line-height:1.4;min-height:7em}
.limits{max-width:1100px;margin:0 0 16px;line-height:1.5}
iframe{height:2600px;border:0;background:#fff;box-shadow:0 1px 4px #0003}</style>
</head><body><p><b>${esc(title)}</b> · local preview</p>
<p class="limits">The dark frames are approximations of each client's colour change, made in Chrome. They are not renders; Litmus is the proof.
Chrome does not draw Outlook-only code (<code>&lt;!--[if mso]&gt;</code> blocks, VML), so the Outlook frame shows the non-Outlook HTML with
Outlook's colour change. A CSS background image stands in for its VML twin; one with no VML twin is left out, as Outlook shows none.
The Word layout engine (widths, padding, line height, font fallback, image scaling) is not simulated. The Outlook frame is 600px wide, because classic Outlook is a desktop client.
Apple Mail shows only the email's own dark styles.</p>
<div class="row">${frame("Desktop 600px", 640)}${frame("Mobile 375px", 375)}${DARK_MODES.map((m) => {
    const w = m.id === "outlook-windows" ? 640 : 375;
    return frame(`${m.label} dark, ${w === 640 ? "600px" : "375px"} · approximation`, w, m.id, m.note);
  }).join("")}</div>
</body></html>`;
}

async function handle(req, res, root) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET") return send(res, 405, "Only GET");
    if (url.pathname === "/compare") {
      const src = url.searchParams.get("src") || "";
      if (!src.startsWith("/c/")) return send(res, 400, "Bad src");
      return send(res, 200, comparePage(src, url.searchParams.get("title") || src), TYPES[".html"]);
    }
    if (!url.pathname.startsWith("/c/")) return send(res, 404, "Not found");
    const rel = decodeURIComponent(url.pathname.slice(3));
    const file = await realpath(path.join(root, ...rel.split("/")));
    if (!isInside(root, file)) return send(res, 403, "Outside the workspace");
    let body = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const dark = url.searchParams.get("dark");
    if (ext === ".html" && dark) {
      const mode = dark === "1" ? LEGACY_DARK : dark;
      if (!DARK_MODES.some((m) => m.id === mode)) {
        return send(res, 400, `Unknown dark mode "${dark}". Use one of: ${DARK_MODES.map((m) => m.id).join(", ")}.`);
      }
      body = Buffer.from(simulateDark(body.toString("utf8"), mode));
    }
    return send(res, 200, body, TYPES[ext] || "application/octet-stream");
  } catch (e) {
    return send(res, e.code === "ENOENT" ? 404 : 500, e.code === "ENOENT" ? "Not found" : "Error");
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

// One server per email-build process, serving <workspace>/clients.
export async function ensurePreviewServer(clientsRoot) {
  const root = await realpath(clientsRoot);
  if (state && state.root === root) return state;
  if (state) state.server.close();
  const server = createServer((req, res) => handle(req, res, root));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  state = { server, port: server.address().port, root };
  return state;
}

export function previewUrls(port, clientsRoot, htmlFile, title) {
  const rel = path.relative(clientsRoot, htmlFile).split(path.sep).map(encodeURIComponent).join("/");
  const base = `http://127.0.0.1:${port}`;
  const src = `/c/${rel}`;
  return {
    compare: `${base}/compare?src=${encodeURIComponent(src)}&title=${encodeURIComponent(title)}`,
    desktop: `${base}${src}`,
    dark: `${base}${src}?dark=${LEGACY_DARK}`,
    ...Object.fromEntries(DARK_MODES.map((m) => [darkKey(m.id), `${base}${src}?dark=${m.id}`])),
  };
}

export function openInBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]] // no cmd.exe, so "&" in the URL is safe
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}
