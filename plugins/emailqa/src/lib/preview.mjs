// Local preview server: serves the workspace's clients/ folder read-only on 127.0.0.1, plus a compare page
// that shows an email at 600px, at 375px (mobile breakpoint) and with a simulated dark mode.
// Chrome can't open file:// pages for Claude, so this replaces ad-hoc localhost servers.

import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { isInside } from "./workspace.mjs";

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

// Full-invert dark mode, like the Gmail app: the page inverts, images are inverted back.
const DARK_CSS =
  "<style id=\"emailqa-dark\">html{background:#ffffff!important;filter:invert(1) hue-rotate(180deg)!important}" +
  "img,[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)!important}</style>";

let state = null; // { server, port, root }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function comparePage(src, title) {
  const frame = (label, w, dark) =>
    `<figure><figcaption>${label}</figcaption><iframe src="${esc(src)}${dark ? "?dark=1" : ""}" style="width:${w}px"></iframe></figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · EmailQA preview</title>
<style>body{margin:0;padding:16px;background:#e9e9ec;font:13px system-ui,sans-serif;color:#222}
.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}
figcaption{margin:0 0 6px;font-weight:600}iframe{height:2600px;border:0;background:#fff;box-shadow:0 1px 4px #0003}</style>
</head><body><p><b>${esc(title)}</b> · local preview (dark mode is a simulation of a full-invert client such as the Gmail app)</p>
<div class="row">${frame("Desktop 600px", 640, false)}${frame("Mobile 375px", 375, false)}${frame("Mobile 375px, dark (simulated)", 375, true)}</div>
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
    if (ext === ".html" && url.searchParams.get("dark") === "1") {
      const html = body.toString("utf8");
      body = Buffer.from(html.includes("</head>") ? html.replace("</head>", DARK_CSS + "</head>") : DARK_CSS + html);
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
    dark: `${base}${src}?dark=1`,
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
