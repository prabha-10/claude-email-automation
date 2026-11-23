#!/usr/bin/env node
// Limited Klaviyo MCP server for the email-template-tester plugin.
//
// It can:
//   - read images and templates, and check that the key works
//   - upload an image file from the project folder (skipping files it already uploaded)
//   - create or update "[TEST] ..." templates, and render them with sample data
//   - send a TEST email of a "[TEST] ..." template, only to addresses in KLAVIYO_TEST_RECIPIENTS
// It cannot delete anything, send campaigns or real emails, or touch flows, lists, profiles or events.
// Every Klaviyo endpoint it calls is hard-coded below; there is no generic request tool.
//
// API key, first match wins (the key is never printed or returned):
//   1. pipeline.json "klaviyo": { "keyName": "acme" }  ->  ~/.email-template-tester/keys/acme   (per-brand key)
//   2. KLAVIYO_API_KEY environment variable (set from the plugin's install settings)
//   3. ~/.klaviyo-api-key (development fallback)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { projectPath, readProjectConfig, requireProject } from "./lib/project.mjs";

const API = "https://a.klaviyo.com/api";
const REVISION = process.env.KLAVIYO_REVISION || "2026-10-15";
const DEFAULT_PREFIX = "[TEST] ";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Klaviyo image limit
const MAX_HTML_BYTES = 1024 * 1024;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
const MAX_RETRIES = 4;

// ---------- key ----------

function parseKey(raw) {
  const m = raw.match(/KLAVIYO_API_KEY\s*=\s*(\S+)/) || raw.match(/^\s*(\S+)\s*$/);
  return m ? m[1] : null;
}

async function resolveKey() {
  const config = await readProjectConfig().catch(() => null);
  const keyName = config?.klaviyo?.keyName;
  if (keyName) {
    if (!/^[A-Za-z0-9_-]+$/.test(keyName)) throw new Error(`pipeline.json klaviyo.keyName "${keyName}" may only use letters, numbers, - and _.`);
    const file = path.join(homedir(), ".email-template-tester", "keys", keyName);
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      throw new Error(`This project uses the Klaviyo key "${keyName}", but ${file} doesn't exist. Ask the user to save that key there.`);
    }
    const key = parseKey(raw);
    if (!key) throw new Error(`Could not read a key from ${file}. Expected KLAVIYO_API_KEY=pk_... or just the key.`);
    return { key, source: `project key "${keyName}" (~/.email-template-tester/keys/${keyName})` };
  }
  const env = (process.env.KLAVIYO_API_KEY || "").trim();
  if (env && !env.startsWith("${")) return { key: env, source: "plugin settings" };
  try {
    const key = parseKey(await readFile(path.join(homedir(), ".klaviyo-api-key"), "utf8"));
    if (key) return { key, source: "~/.klaviyo-api-key (development fallback)" };
  } catch {}
  throw new Error("No Klaviyo API key found. Set it in the plugin settings (/plugin configure), or give this project its own key.");
}

const fingerprint = (key) => createHash("sha256").update(key).digest("hex").slice(0, 12);

// ---------- HTTP with retry ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function klaviyo(method, pathAndQuery, { json, form } = {}) {
  const { key } = await resolveKey();
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json" };
    let body;
    if (json) {
      headers["content-type"] = "application/vnd.api+json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form(); // a fresh FormData per attempt
    }
    const res = await fetch(API + pathAndQuery, { method, headers, body });
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const detail = (data.errors || []).map((e) => `${e.title}: ${e.detail}`).join("; ") || text.slice(0, 300);
      const hint = res.status === 429 ? " (Klaviyo rate limit; try again later)" : res.status === 403 ? " (the key lacks a permission this needs)" : "";
      throw new Error(`Klaviyo ${method} ${pathAndQuery.split("?")[0]} returned HTTP ${res.status}${hint}: ${detail}`);
    }
    return data;
  }
}

const nextCursor = (links) => {
  if (!links?.next) return null;
  try {
    return new URL(links.next).searchParams.get("page[cursor]");
  } catch {
    return null;
  }
};

// ---------- formatting ----------

const imageSummary = ({ id, attributes: a }) => ({
  id,
  name: a.name,
  url: a.image_url,
  format: a.format,
  size_bytes: a.size,
  hidden: a.hidden,
  updated: a.updated_at,
});

async function testPrefix() {
  const config = await readProjectConfig().catch(() => null);
  return config?.templatePrefix || DEFAULT_PREFIX;
}

const templateSummary = (prefix) => ({ id, attributes: a }) => ({
  id,
  name: a.name,
  editor_type: a.editor_type,
  created: a.created,
  updated: a.updated,
  ...(a.html !== undefined ? { html_bytes: Buffer.byteLength(a.html || "") } : {}),
  is_test_template: (a.name || "").startsWith(prefix),
});

async function readHtml(htmlPath) {
  const file = await projectPath(htmlPath);
  const html = await readFile(file, "utf8");
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error(`HTML file is larger than 1 MB: ${htmlPath}`);
  return html;
}

// ---------- upload cache (skip files already uploaded with this key) ----------

const CACHE_FILE = ".pipeline/klaviyo-images.json";

async function loadCache(root) {
  try {
    return JSON.parse(await readFile(path.join(root, CACHE_FILE), "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(root, cache) {
  await mkdir(path.join(root, ".pipeline"), { recursive: true });
  await writeFile(path.join(root, CACHE_FILE), JSON.stringify(cache, null, 2));
}

// ---------- server ----------

const server = new McpServer({ name: "klaviyo", version: "0.1.0" });

const ok = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
const tool = (name, description, inputSchema, fn) =>
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  });

const allowedRecipients = () =>
  (process.env.KLAVIYO_TEST_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !s.startsWith("${"));

tool(
  "check_connection",
  "Check that the Klaviyo key works (read-only). Reports where the key comes from, the test-template prefix and how many test recipients are allowed, and warns about recipients that aren't Litmus addresses. Never shows the key.",
  {},
  async () => {
    const { source } = await resolveKey();
    await klaviyo("GET", "/images?fields[image]=name");
    const recipients = allowedRecipients();
    const notLitmus = recipients.filter((r) => !r.endsWith("@litmusemail.com"));
    return {
      key_works: true,
      key_source: source,
      template_prefix: await testPrefix(),
      test_recipients_allowed: recipients.length,
      ...(notLitmus.length && { warning: `Test emails are also allowed to go to non-Litmus addresses: ${notLitmus.join(", ")}` }),
    };
  }
);

tool(
  "list_images",
  "List images in the Klaviyo image library (read-only). Optionally filter by name (case-insensitive, applied to this page).",
  { name_contains: z.string().optional(), page_cursor: z.string().optional() },
  async ({ name_contains, page_cursor }) => {
    const q = page_cursor ? `?page[cursor]=${encodeURIComponent(page_cursor)}` : "";
    const res = await klaviyo("GET", `/images${q}`);
    let images = (res.data || []).map(imageSummary);
    if (name_contains) images = images.filter((i) => i.name.toLowerCase().includes(name_contains.toLowerCase()));
    return { images, next_page_cursor: nextCursor(res.links) };
  }
);

tool("get_image", "Get one image by ID (read-only).", { id: z.string() }, async ({ id }) =>
  imageSummary((await klaviyo("GET", `/images/${encodeURIComponent(id)}`)).data)
);

tool(
  "upload_image",
  "Upload a PNG, JPG or GIF from the project folder to the Klaviyo image library and return its hosted URL. If the same file was already uploaded with this key, returns the existing image instead. Max 5 MB.",
  {
    file_path: z.string().describe("Path inside the project, e.g. emails/wedding-invite/images/hero.jpg"),
    name: z.string().optional().describe("Image name in Klaviyo. Defaults to the file name."),
  },
  async ({ file_path, name }) => {
    const { root } = await requireProject();
    const file = await projectPath(file_path);
    const ext = path.extname(file).toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) throw new Error(`Only ${Object.keys(IMAGE_TYPES).join(", ")} files can be uploaded: ${file_path}`);
    const { size } = await stat(file);
    if (size > MAX_IMAGE_BYTES) throw new Error(`File is ${size} bytes; Klaviyo's limit is 5 MB.`);
    const bytes = await readFile(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const { key } = await resolveKey();
    const fp = fingerprint(key);
    const cache = await loadCache(root);
    const hit = cache[fp]?.[sha];
    if (hit) {
      try {
        const existing = imageSummary((await klaviyo("GET", `/images/${encodeURIComponent(hit.id)}`)).data);
        if (!existing.hidden) return { ...existing, reused: true, local_file: path.relative(root, file) };
      } catch {
        // Image no longer available; upload again below.
      }
    }
    const res = await klaviyo("POST", "/image-upload", {
      form: () => {
        const f = new FormData();
        f.append("file", new Blob([bytes], { type }), path.basename(file));
        f.append("name", name || path.basename(file));
        return f;
      },
    });
    const img = imageSummary(res.data);
    cache[fp] = { ...(cache[fp] || {}), [sha]: { id: img.id, url: img.url, name: img.name, size_bytes: size } };
    await saveCache(root, cache);
    return { ...img, reused: false, local_file: path.relative(root, file), local_size_bytes: size };
  }
);

tool(
  "list_templates",
  "List email templates (read-only, without their HTML). Optionally filter by name (case-insensitive, applied to this page).",
  { name_contains: z.string().optional(), page_cursor: z.string().optional() },
  async ({ name_contains, page_cursor }) => {
    const prefix = await testPrefix();
    const params = ["fields[template]=name,editor_type,created,updated"];
    if (page_cursor) params.push(`page[cursor]=${encodeURIComponent(page_cursor)}`);
    const res = await klaviyo("GET", `/templates?${params.join("&")}`);
    let templates = (res.data || []).map(templateSummary(prefix));
    if (name_contains) templates = templates.filter((t) => t.name.toLowerCase().includes(name_contains.toLowerCase()));
    return { templates, next_page_cursor: nextCursor(res.links) };
  }
);

tool(
  "get_template",
  "Get one template's details (read-only). Optionally save its HTML to a file inside the project folder.",
  { id: z.string(), save_html_to: z.string().optional().describe("e.g. emails/wedding-invite/qa/klaviyo-stored.html") },
  async ({ id, save_html_to }) => {
    const prefix = await testPrefix();
    const res = await klaviyo("GET", `/templates/${encodeURIComponent(id)}`);
    const out = templateSummary(prefix)(res.data);
    if (save_html_to) {
      await requireProject();
      const target = await projectPath(save_html_to, { mustExist: false });
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, res.data.attributes.html || "");
      out.saved_html_to = save_html_to;
    }
    return out;
  }
);

async function findTemplateByName(name) {
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const params = ["fields[template]=name"];
    if (cursor) params.push(`page[cursor]=${encodeURIComponent(cursor)}`);
    const res = await klaviyo("GET", `/templates?${params.join("&")}`);
    const match = (res.data || []).find((t) => t.attributes.name === name);
    if (match) return match.id;
    cursor = nextCursor(res.links);
    if (!cursor) return null;
  }
  return null;
}

tool(
  "upsert_template",
  "Create or update a custom-HTML (CODE) template from an HTML file in the project. The name always gets the project's test prefix (default \"[TEST] \"). If a template with that exact name exists it is updated in place, so new versions don't pile up. Pass template_id to update a known template directly.",
  {
    name: z.string().describe("e.g. \"Acme / spring-sale\". The test prefix is added automatically."),
    html_path: z.string().describe("e.g. emails/spring-sale/build/email.html"),
    template_id: z.string().optional(),
  },
  async ({ name, html_path, template_id }) => {
    await requireProject();
    const prefix = await testPrefix();
    const fullName = name.startsWith(prefix) ? name : prefix + name;
    const html = await readHtml(html_path);
    const summarize = templateSummary(prefix);
    let id = template_id || (await findTemplateByName(fullName));
    if (id) {
      const current = (await klaviyo("GET", `/templates/${encodeURIComponent(id)}?fields[template]=name`)).data;
      if (!(current.attributes.name || "").startsWith(prefix)) {
        throw new Error(`Refusing to update "${current.attributes.name}": only "${prefix}..." templates can be changed.`);
      }
      const res = await klaviyo("PATCH", `/templates/${encodeURIComponent(id)}`, {
        json: { data: { type: "template", id, attributes: { name: fullName, html } } },
      });
      return { action: "updated", ...summarize(res.data) };
    }
    const res = await klaviyo("POST", "/templates", {
      json: { data: { type: "template", attributes: { name: fullName, editor_type: "CODE", html } } },
    });
    return { action: "created", ...summarize(res.data) };
  }
);

tool(
  "render_template",
  "Render a template with sample data (e.g. {\"first_name\":\"Paula\"}) to check Klaviyo tags. Nothing is sent. Saves the rendered HTML inside the project and reports any tags left unrendered.",
  {
    id: z.string(),
    context: z.record(z.string(), z.any()).default({}),
    save_to: z.string().describe("e.g. emails/wedding-invite/qa/klaviyo-render.html"),
  },
  async ({ id, context, save_to }) => {
    await requireProject();
    const res = await klaviyo("POST", "/template-render", {
      json: { data: { type: "template", id, attributes: { context } } },
    });
    const a = res.data.attributes;
    const html = a.html || "";
    const target = await projectPath(save_to, { mustExist: false });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
    const leftover = [...html.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)].map((m) => m[0]);
    return {
      saved_to: save_to,
      html_bytes: Buffer.byteLength(html),
      unrendered_tags: [...new Set(leftover)],
      text_preview: (a.text || "").slice(0, 400),
    };
  }
);

tool(
  "send_test_email",
  "Send a TEST email of a test-prefixed template (Klaviyo template preview send, max 5 recipients, about 100 per day per account). Recipients must be in the allowlist from the plugin settings, normally the user's Litmus test address. This cannot send campaigns or email customers.",
  {
    id: z.string(),
    recipients: z.array(z.string()).min(1).max(5).optional().describe("Defaults to every allowlisted address (max 5)"),
    context: z.record(z.string(), z.any()).default({}),
  },
  async ({ id, recipients, context }) => {
    await requireProject();
    const allowed = allowedRecipients();
    if (!allowed.length) {
      throw new Error("No test recipients are allowed. Set your Litmus test address in the plugin settings (/plugin configure).");
    }
    const to = (recipients || allowed).map((r) => r.trim().toLowerCase());
    const blocked = to.filter((r) => !allowed.includes(r));
    if (blocked.length) throw new Error(`Not in the test-recipient allowlist: ${blocked.join(", ")}`);
    if (to.length > 5) throw new Error("Klaviyo allows at most 5 recipients per test send.");
    const prefix = await testPrefix();
    const current = (await klaviyo("GET", `/templates/${encodeURIComponent(id)}?fields[template]=name`)).data;
    if (!(current.attributes.name || "").startsWith(prefix)) {
      throw new Error(`Refusing to test-send "${current.attributes.name}": only "${prefix}..." templates can be test-sent.`);
    }
    const res = await klaviyo("POST", "/template-preview-send-jobs", {
      json: {
        data: {
          type: "template-preview-send-job",
          attributes: { recipients: to, context },
          relationships: { template: { data: { type: "template", id } } },
        },
      },
    });
    return { job_id: res.data.id, status: res.data.attributes.status, template: current.attributes.name, sent_to: to };
  }
);

await server.connect(new StdioServerTransport());
