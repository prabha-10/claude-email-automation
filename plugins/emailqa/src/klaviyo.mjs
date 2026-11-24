#!/usr/bin/env node
// EmailQA Klaviyo server, for the agency's own Klaviyo TEST account only (key from the plugin settings).
//
// It can: check the key; read images and templates; upload images from an email folder (skipping files
// already uploaded); create or update "[TEST] <client> / <email>" templates and render them; send a test
// of such a template only to the Litmus test address (or its +folder variants).
// It cannot delete anything, send campaigns or real emails, or touch flows, lists, profiles or events.
// Every endpoint is hard-coded; there is no generic request tool.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { VERSION, envValue, now, readJson, registerTools, writeJson } from "./lib/common.mjs";
import { isAllowedRecipient, litmusBases, requireEmail, requireWorkspace, saveRecord, within } from "./lib/workspace.mjs";

const API = "https://a.klaviyo.com/api";
const REVISION = envValue("KLAVIYO_REVISION") || "2026-10-15";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 1024 * 1024;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
const MAX_RETRIES = 4;
// Litmus rounds per email. Round 1 shows every problem; round 2 confirms the fixes. Each send to the
// Litmus address uses one set of previews (one per selected email client), so more rounds cost credits.
const LITMUS_ROUNDS = 2;

/** Litmus sends of this email so far. Older records only have history notes, so read those too. */
function litmusSends(record) {
  if (Array.isArray(record.litmusSends)) return record.litmusSends;
  return (record.history || [])
    .map((h) => ({ h, m: /^v(\d+) test-sent to (.+)$/.exec(h.note || "") }))
    .filter(({ m }) => m)
    .map(({ h, m }) => ({ at: h.at, version: Number(m[1]), sha: null, to: m[2].split(", ") }));
}

const clientArg = z.string().describe('Client folder name, e.g. "acme"');
const emailArg = z.string().describe('Email folder path, e.g. "spring-sale" or "black-friday/teaser"');

// ---------- key and HTTP ----------

function apiKey() {
  const key = envValue("KLAVIYO_API_KEY");
  if (!key) {
    throw new Error(
      "No Klaviyo key set. Add the Klaviyo TEST account's private key in the EmailQA plugin settings (Customize → Plugins → EmailQA, or /plugin configure in the terminal), then start a new session."
    );
  }
  return key;
}

const fingerprint = (key) => createHash("sha256").update(key).digest("hex").slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function klaviyo(method, pathAndQuery, { json, form } = {}) {
  const key = apiKey();
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json" };
    let body;
    if (json) {
      headers["content-type"] = "application/vnd.api+json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form();
    }
    const res = await fetch(API + pathAndQuery, { method, headers, body, signal: AbortSignal.timeout(60000) });
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** attempt);
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
      const hint =
        res.status === 429 ? " (Klaviyo rate limit; test sends are about 100 a day per account)" : res.status === 401 ? " (the key is wrong)" : res.status === 403 ? " (the key lacks a permission this needs)" : "";
      throw new Error(`Klaviyo ${method} ${pathAndQuery.split("?")[0]} returned HTTP ${res.status}${hint}: ${detail}`);
    }
    return data;
  }
}

const nextCursor = (links) => {
  try {
    return links?.next ? new URL(links.next).searchParams.get("page[cursor]") : null;
  } catch {
    return null;
  }
};

const imageSummary = ({ id, attributes: a }) => ({ id, name: a.name, url: a.image_url, format: a.format, size_bytes: a.size, hidden: a.hidden, updated: a.updated_at });

async function testPrefix() {
  const ws = await requireWorkspace().catch(() => null);
  return ws?.config?.templatePrefix || "[TEST] ";
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

async function assertTestTemplate(id, prefix) {
  const current = (await klaviyo("GET", `/templates/${encodeURIComponent(id)}?fields[template]=name`)).data;
  if (!(current.attributes.name || "").startsWith(prefix)) {
    throw new Error(`Refusing to touch "${current.attributes.name}": only "${prefix}…" templates can be changed or test-sent.`);
  }
  return current.attributes.name;
}

// ---------- server ----------

const server = new McpServer({ name: "klaviyo", version: VERSION });
const tool = registerTools(server);

tool(
  "check_connection",
  "Check the Klaviyo test-account key works (read-only) and which Litmus addresses test sends may go to. Never shows the key.",
  {},
  async () => {
    const key = apiKey();
    await klaviyo("GET", "/images?fields[image]=name");
    const bases = litmusBases();
    return {
      key_works: true,
      key_id: fingerprint(key),
      template_prefix: await testPrefix(),
      test_sends_allowed_to: bases.length ? bases.map((b) => `${b} (and ${b.replace("@", "+…@")})`) : [],
      ...(bases.length === 0 && { warning: "No Litmus test address set, so test sends are off. Add it in the plugin settings." }),
    };
  }
);

tool(
  "list_images",
  "List images in the Klaviyo test account's image library (read-only). Optional name filter applies to this page.",
  { name_contains: z.string().optional(), page_cursor: z.string().optional() },
  async ({ name_contains, page_cursor }) => {
    const res = await klaviyo("GET", `/images${page_cursor ? `?page[cursor]=${encodeURIComponent(page_cursor)}` : ""}`);
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
  "Upload a PNG, JPG or GIF from the email's folder to Klaviyo and record its hosted URL in email.json (klaviyo.images). The same file content is never uploaded twice; a changed file gets a new upload and the old URL is listed under klaviyo.supersededImages. Max 5 MB.",
  { client: clientArg, email: emailArg, file: z.string().describe('Path inside the email folder, e.g. "images/hero.jpg"') },
  async ({ client, email, file }) => hostImage(await requireEmail(client, email), client, file)
);

tool(
  "host_images",
  "Host every image the email uses in ONE call, instead of upload_image per file and hand edits: finds each ../images/<file> reference in email.mjml (mj-image src, background-url, CSS url() and Outlook VML), uploads it (reusing unchanged files), and rewrites email.mjml to the hosted links. Also re-uploads images hosted earlier whose file changed since, and swaps their links. Then run compile_email and precheck_email.",
  { client: clientArg, email: emailArg },
  async ({ client, email }) => {
    const e = await requireEmail(client, email);
    const mjmlFile = await within(e.emailDir, "email.mjml").catch(() => {
      throw new Error(`No email.mjml yet in ${e.emailDir}.`);
    });
    let mjml = await readFile(mjmlFile, "utf8");
    const hosted = [];
    const missing = [];
    // 1. Local references.
    const local = [...new Set([...mjml.matchAll(/\.\.\/images\/[^"'()\s<>]+/g)].map((m) => m[0]))];
    for (const ref of local) {
      const file = ref.replace(/^\.\.\//, "");
      try {
        const r = await hostImage(e, client, file);
        mjml = mjml.split(ref).join(r.url);
        hosted.push(r);
      } catch (err) {
        missing.push({ file, error: String(err.message || err) });
      }
    }
    // 2. Images hosted in an earlier round whose file changed since.
    for (const [rel, url] of Object.entries({ ...(e.record.klaviyo?.images || {}) })) {
      if (!mjml.includes(url) || hosted.some((h) => h.file === rel)) continue;
      const exists = await within(e.emailDir, rel).then(
        () => true,
        () => false
      );
      if (!exists) continue;
      const r = await hostImage(e, client, rel);
      if (r.url !== url) mjml = mjml.split(url).join(r.url);
      hosted.push(r);
    }
    await writeFile(mjmlFile, mjml);
    return {
      hosted: hosted.map(({ file, url, reused, replaced }) => ({ file, url, ...(reused ? { reused } : { uploaded: true }), ...(replaced && { replaced }) })),
      uploaded: hosted.filter((h) => !h.reused).length,
      reused: hosted.filter((h) => h.reused).length,
      ...(missing.length && { not_hosted: missing }),
      next: missing.length ? "Fix the files in not_hosted, then call host_images again." : "compile_email, then precheck_email.",
    };
  }
);

/** Upload one image file of an email (or reuse an identical upload) and record its hosted URL. */
async function hostImage(e, client, file) {
  {
    if (/^https?:\/\//i.test(file)) throw new Error(`Already a hosted link, not a file: ${file}`);
    const abs = await within(e.emailDir, file);
    const rel = path.relative(e.emailDir, abs).split(path.sep).join("/");
    const type = IMAGE_TYPES[path.extname(abs).toLowerCase()];
    if (!type) throw new Error(`Only ${Object.keys(IMAGE_TYPES).join(", ")} files can be uploaded: ${rel}`);
    const { size } = await stat(abs);
    if (size > MAX_IMAGE_BYTES) throw new Error(`File is ${size} bytes; Klaviyo's limit is 5 MB.`);
    const bytes = await readFile(abs);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const fp = fingerprint(apiKey());
    const cacheFile = path.join(e.dir, ".cache", "klaviyo-images.json");
    const cache = await readJson(cacheFile, {});
    let img = null;
    let reused = false;
    const hit = cache[fp]?.[sha];
    if (hit) {
      try {
        const existing = imageSummary((await klaviyo("GET", `/images/${encodeURIComponent(hit.id)}`)).data);
        if (!existing.hidden) {
          img = existing;
          reused = true;
        }
      } catch {
        // gone; upload again
      }
    }
    if (!img) {
      const name = `${client}__${e.email.replace(/\//g, "_")}__${path.basename(abs)}`.slice(0, 120);
      const res = await klaviyo("POST", "/image-upload", {
        form: () => {
          const f = new FormData();
          f.append("file", new Blob([bytes], { type }), path.basename(abs));
          f.append("name", name);
          return f;
        },
      });
      img = imageSummary(res.data);
      cache[fp] = { ...(cache[fp] || {}), [sha]: { id: img.id, url: img.url, name: img.name, size_bytes: size, file: `${e.email}/${rel}` } };
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeJson(cacheFile, cache);
    }
    const k = (e.record.klaviyo ||= {});
    k.images ||= {};
    k.supersededImages ||= [];
    const previous = k.images[rel];
    if (previous && previous !== img.url) k.supersededImages.push({ file: rel, url: previous, replacedAt: now() });
    k.images[rel] = img.url;
    await saveRecord(e.recordFile, e.record);
    return { file: rel, url: img.url, id: img.id, reused, ...(previous && previous !== img.url && { replaced: previous }) };
  }
}

tool(
  "list_templates",
  "List templates in the Klaviyo test account (read-only, without HTML). Optional name filter applies to this page.",
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

tool("get_template", "Get one template's details (read-only).", { id: z.string() }, async ({ id }) =>
  templateSummary(await testPrefix())((await klaviyo("GET", `/templates/${encodeURIComponent(id)}`)).data)
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
  'Publish the email\'s build/email.html as a custom-HTML template named "[TEST] <client name> / <email>". Updates the same template every round (ID kept in email.json), bumps the email\'s version, and records it. Does nothing if the HTML is unchanged since the last publish.',
  { client: clientArg, email: emailArg },
  async ({ client, email }) => {
    const e = await requireEmail(client, email);
    const prefix = await testPrefix();
    const html = await readFile(path.join(e.emailDir, "build", "email.html"), "utf8").catch(() => {
      throw new Error("No build/email.html. Run compile_email first.");
    });
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error("build/email.html is larger than 1 MB.");
    if (/src="(?!https:\/\/)[^"]+"/i.test(html.replace(/<!--[\s\S]*?-->/g, ""))) {
      throw new Error("The email still has local images. Upload them with upload_image and use the returned URLs first.");
    }
    const sha = createHash("sha256").update(html).digest("hex");
    const k = (e.record.klaviyo ||= {});
    const fullName = `${prefix}${e.config.name} / ${e.email}`;
    if (k.templateId && k.publishedSha === sha) {
      return { action: "unchanged", template_id: k.templateId, name: k.templateName, version: e.record.version };
    }
    const summarize = templateSummary(prefix);
    let id = k.templateId || (await findTemplateByName(fullName));
    let res;
    let action;
    if (id) {
      await assertTestTemplate(id, prefix);
      res = await klaviyo("PATCH", `/templates/${encodeURIComponent(id)}`, { json: { data: { type: "template", id, attributes: { name: fullName, html } } } });
      action = "updated";
    } else {
      res = await klaviyo("POST", "/templates", { json: { data: { type: "template", attributes: { name: fullName, editor_type: "CODE", html } } } });
      action = "created";
      id = res.data.id;
    }
    e.record.version = (e.record.version || 0) + 1;
    Object.assign(k, { templateId: id, templateName: fullName, publishedSha: sha, publishedAt: now() });
    (e.record.history ||= []).push({ at: now(), note: `v${e.record.version} published to Klaviyo test template ${id} (${action})` });
    await saveRecord(e.recordFile, e.record);
    return { action, version: e.record.version, qa_folder: `qa/v${e.record.version}/`, ...summarize(res.data) };
  }
);

tool(
  "render_template",
  "Render the email's Klaviyo template with sample data (e.g. {\"first_name\":\"Paula\"}) to check the Klaviyo tags. Nothing is sent. Saves qa/v<version>/klaviyo-render.html and reports tags left unrendered.",
  { client: clientArg, email: emailArg, context: z.record(z.string(), z.any()).default({}) },
  async ({ client, email, context }) => {
    const e = await requireEmail(client, email);
    const id = e.record.klaviyo?.templateId;
    if (!id) throw new Error("This email has no Klaviyo template yet. Run upsert_template first.");
    const res = await klaviyo("POST", "/template-render", { json: { data: { type: "template", id, attributes: { context } } } });
    const a = res.data.attributes;
    const html = a.html || "";
    const target = await within(e.emailDir, path.join("qa", `v${e.record.version}`, "klaviyo-render.html"), { mustExist: false });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
    const leftover = [...new Set([...html.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)].map((m) => m[0]))];
    return { saved_to: `qa/v${e.record.version}/klaviyo-render.html`, html_bytes: Buffer.byteLength(html), unrendered_tags: leftover, text_preview: (a.text || "").slice(0, 400) };
  }
);

tool(
  "send_test_email",
  "Send a TEST email of this email's [TEST] template to Litmus (Klaviyo preview send, max 5 recipients, about 100 a day per account). Defaults to the client's Litmus folder address, else your Litmus address. Only your Litmus address and its +folder variants are allowed. Can't send campaigns or email customers. Each email gets 2 Litmus rounds (round 1 finds every problem, round 2 confirms the fixes); it refuses a third unless extra_round is true, and refuses a re-send of an unchanged template.",
  {
    client: clientArg,
    email: emailArg,
    context: z.record(z.string(), z.any()).default({}),
    recipients: z.array(z.string()).min(1).max(5).optional(),
    extra_round: z
      .boolean()
      .default(false)
      .describe(`Only when the user explicitly asked for another Litmus round beyond the ${LITMUS_ROUNDS} each email gets.`),
  },
  async ({ client, email, context, recipients, extra_round }) => {
    const e = await requireEmail(client, email);
    const id = e.record.klaviyo?.templateId;
    if (!id) throw new Error("This email has no Klaviyo template yet. Run upsert_template first.");
    const sends = litmusSends(e.record);
    const last = sends[sends.length - 1];
    if (last?.sha && last.sha === e.record.klaviyo?.publishedSha) {
      throw new Error(
        `Nothing changed since the last Litmus send (v${last.version}), so another send would spend Litmus previews on the same email. Edit email.mjml, compile_email and upsert_template first.`
      );
    }
    if (sends.length >= LITMUS_ROUNDS && !extra_round) {
      throw new Error(
        `This email already used its ${LITMUS_ROUNDS} Litmus rounds (${sends.map((s) => `v${s.version}`).join(", ")}). Check further fixes with preview_email instead. Only if the user explicitly asks for another Litmus round, call again with extra_round: true.`
      );
    }
    const bases = litmusBases();
    if (!bases.length) throw new Error("No Litmus test address set in the plugin settings, so test sends are off.");
    const to = (recipients || [e.config.litmus?.address || bases[0]]).map((r) => r.trim().toLowerCase());
    const blocked = to.filter((r) => !isAllowedRecipient(r, bases));
    if (blocked.length) throw new Error(`Not allowed (only your Litmus address and its +folder variants): ${blocked.join(", ")}`);
    const name = await assertTestTemplate(id, await testPrefix());
    const res = await klaviyo("POST", "/template-preview-send-jobs", {
      json: {
        data: {
          type: "template-preview-send-job",
          attributes: { recipients: to, context },
          relationships: { template: { data: { type: "template", id } } },
        },
      },
    });
    (e.record.history ||= []).push({ at: now(), note: `v${e.record.version} test-sent to ${to.join(", ")}` });
    sends.push({ at: now(), version: e.record.version, sha: e.record.klaviyo?.publishedSha || null, to });
    e.record.litmusSends = sends;
    await saveRecord(e.recordFile, e.record);
    return {
      job_id: res.data.id,
      status: res.data.attributes.status,
      template: name,
      version: e.record.version,
      sent_to: to,
      litmus_round: sends.length,
      litmus_rounds_left: Math.max(0, LITMUS_ROUNDS - sends.length),
    };
  }
);

await server.connect(new StdioServerTransport());
