#!/usr/bin/env node
// Build server for the email-template-tester plugin: project folders, MJML compile, pre-checks, email records.
//
// Project layout (one folder per brand or client, created by init_project):
//   pipeline.json              brand, Figma file, test-template prefix, optional per-brand Klaviyo key name
//   emails/<slug>/
//     email.json               record: Figma node, version, Klaviyo template + image URLs, test runs, history
//     email.mjml               source, written by Claude
//     design/                  Figma screenshot and notes
//     images/                  exported images (2x)
//     build/email.html         compiled output
//     qa/                      renders, Litmus screenshots and findings
//     handoff/v<N>/            for the client's Klaviyo: images/ to upload, then <slug>-final.html
//   .pipeline/                 caches (e.g. which images are already in Klaviyo)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import mjml2html from "mjml";
import { readFile, writeFile, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  assertSafeRoot,
  emailDir,
  projectPath,
  projectRoot,
  projectRootRaw,
  readProjectConfig,
  requireProject,
  slugify,
} from "./lib/project.mjs";
import { runChecks } from "../scripts/preflight.mjs";
import { accountIdOf, imageInfo, imageUrlsIn, matchLinks, sha256, swapLinks } from "./lib/handoff.mjs";

const server = new McpServer({ name: "email-build", version: "0.1.0" });
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
const now = () => new Date().toISOString();

// ---------- install check ----------

tool(
  "check_install",
  "Read-only install check: a second Figma server that would compete with the plugin's own, missing plugin packages, and this project's own Klaviyo key file. Returns each problem with its fix. Never shows keys.",
  {},
  async () => {
    const problems = runChecks({ projectDir: projectRootRaw() });
    return { ok: problems.length === 0, problems };
  }
);

// ---------- email records ----------

async function recordPath(slug) {
  return projectPath(path.join(emailDir(slug), "email.json"), { mustExist: false });
}

async function readRecord(slug) {
  const file = await recordPath(slug);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`No email named "${slug}" in this project. Create it with new_email first.`);
    throw e;
  }
}

async function writeRecord(slug, record) {
  const file = await recordPath(slug);
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// ---------- project tools ----------

tool(
  "init_project",
  "Set up the current folder as an email project for one brand or client: writes pipeline.json and an emails/ folder. Run once per folder. Does nothing if the folder is already a project.",
  {
    brand: z.string().describe("Brand or client name, e.g. \"Acme\""),
    figma_file_url: z.string().optional(),
    klaviyo_key_name: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
      .describe("Only if this brand has its own Klaviyo account: key file name under ~/.email-template-tester/keys/"),
    template_prefix: z.string().optional().describe("Defaults to \"[TEST] \""),
  },
  async ({ brand, figma_file_url, klaviyo_key_name, template_prefix }) => {
    const root = await projectRoot();
    await assertSafeRoot(root);
    const existing = await readProjectConfig();
    if (existing) return { already_initialized: true, project_folder: root, config: existing };
    const config = {
      brand,
      figmaFile: figma_file_url || null,
      templatePrefix: template_prefix || "[TEST] ",
      klaviyo: { keyName: klaviyo_key_name || null },
      created: now(),
    };
    await writeFile(path.join(root, "pipeline.json"), JSON.stringify(config, null, 2) + "\n");
    await mkdir(path.join(root, "emails"), { recursive: true });
    await mkdir(path.join(root, ".pipeline"), { recursive: true });
    return { initialized: true, project_folder: root, config };
  }
);

tool(
  "new_email",
  "Create a folder and record for one email in the current project (emails/<slug>/). Returns the existing record if the email already exists.",
  {
    name: z.string().describe("Human name, e.g. \"Wedding invite\". The folder name is derived from it."),
    figma_url: z.string().optional(),
    figma_node_id: z.string().optional().describe("e.g. 1:4909"),
  },
  async ({ name, figma_url, figma_node_id }) => {
    const { root, config } = await requireProject();
    const slug = slugify(name);
    if (!slug) throw new Error(`Can't make a folder name from "${name}".`);
    const dir = await projectPath(emailDir(slug), { mustExist: false });
    for (const sub of ["design", "images", "build", "qa"]) await mkdir(path.join(dir, sub), { recursive: true });
    try {
      return { created: false, folder: path.relative(root, dir), record: await readRecord(slug) };
    } catch {}
    const record = {
      name,
      slug,
      created: now(),
      figma: { fileUrl: figma_url || config.figmaFile || null, nodeId: figma_node_id || null },
      version: 0,
      klaviyo: { templateId: null, templateName: null, images: {} },
      tests: [],
      history: [{ at: now(), note: "Email created" }],
    };
    await writeRecord(slug, record);
    return { created: true, folder: path.relative(root, dir), record };
  }
);

tool("list_emails", "List the emails in the current project with their version and latest test status.", {}, async () => {
  const { root, config } = await requireProject();
  let entries = [];
  try {
    entries = await readdir(path.join(root, "emails"), { withFileTypes: true });
  } catch {}
  const emails = [];
  for (const e of entries.filter((d) => d.isDirectory())) {
    try {
      const r = JSON.parse(await readFile(path.join(root, "emails", e.name, "email.json"), "utf8"));
      const last = r.tests?.[r.tests.length - 1];
      emails.push({ slug: r.slug, name: r.name, version: r.version, klaviyo_template: r.klaviyo?.templateId || null, last_test: last || null });
    } catch {
      emails.push({ slug: e.name, note: "no email.json" });
    }
  }
  return { brand: config.brand, project_folder: root, emails };
});

tool(
  "update_email_record",
  "Update an email's record (email.json). Deep-merges `patch` (e.g. {\"klaviyo\":{\"templateId\":\"AbC123\"}}), optionally appends one test result to `tests`, and adds a history note.",
  {
    email: z.string().describe("Email folder name (slug)"),
    patch: z.record(z.string(), z.any()).optional(),
    add_test: z.record(z.string(), z.any()).optional().describe("e.g. {\"litmus_email_id\":\"12345678\",\"alerts\":1,\"findings\":[...]}"),
    note: z.string().optional(),
  },
  async ({ email, patch, add_test, note }) => {
    await requireProject();
    const record = await readRecord(email);
    if (patch) deepMerge(record, patch);
    if (add_test) (record.tests ||= []).push({ at: now(), version: record.version, ...add_test });
    if (note) (record.history ||= []).push({ at: now(), note });
    await writeRecord(email, record);
    return record;
  }
);

// ---------- compile ----------

tool(
  "compile_email",
  "Compile emails/<slug>/email.mjml to emails/<slug>/build/email.html with MJML 5. Returns size and any MJML errors.",
  { email: z.string().describe("Email folder name (slug)") },
  async ({ email }) => {
    const { root } = await requireProject();
    const src = await projectPath(path.join(emailDir(email), "email.mjml"));
    const out = await projectPath(path.join(emailDir(email), "build", "email.html"), { mustExist: false });
    const mjml = await readFile(src, "utf8");
    const result = await mjml2html(mjml, { validationLevel: "soft", filePath: src });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, result.html);
    const bytes = Buffer.byteLength(result.html);
    const errors = (result.errors || []).slice(0, 25).map((e) => e.formattedMessage || e.message);
    const record = await readRecord(email).catch(() => null);
    if (record) {
      record.lastBuild = { at: now(), bytes, mjml_errors: errors.length };
      await writeRecord(email, record);
    }
    return { output: path.relative(root, out), kb: +(bytes / 1024).toFixed(1), mjml_errors: errors };
  }
);

// ---------- pre-checks ----------

async function urlStatus(url) {
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { redirect: "follow" });
    return r.status;
  } catch (e) {
    return `ERR ${e.cause?.code || e.message}`;
  }
}

tool(
  "precheck_email",
  "Pre-check emails/<slug>/build/email.html before it goes to Klaviyo or Litmus: size under 90 KB, alt text and https on every image, every image and link responding, no placeholder links, local image paths. Lists the Klaviyo tags found.",
  { email: z.string().describe("Email folder name (slug)"), check_urls: z.boolean().default(true) },
  async ({ email, check_urls }) => {
    const { root } = await requireProject();
    const file = await projectPath(path.join(emailDir(email), "build", "email.html"));
    const html = await readFile(file, "utf8");
    const checks = [];
    const add = (pass, check, detail) => checks.push({ pass, check, ...(detail ? { detail } : {}) });

    const bytes = Buffer.byteLength(html);
    add(bytes < 90 * 1024, "HTML under 90 KB (Gmail clips at ~102 KB)", `${(bytes / 1024).toFixed(1)} KB`);

    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t));
    add(noAlt.length === 0, "Every image has an alt attribute", `${imgs.length} images, ${noAlt.length} missing`);

    const srcs = [...new Set(imgs.map((t) => (t.match(/\bsrc\s*=\s*"([^"]+)"/i) || [])[1]).filter(Boolean))];
    const notHttps = srcs.filter((s) => !s.startsWith("https://"));
    add(notHttps.length === 0, "Every image URL is absolute https (hosted)", notHttps.length ? `local or http: ${notHttps.join(", ")}` : `${srcs.length} unique`);

    add(!/example\.(com|org|net)/i.test(html), "No example.com placeholder links");

    const hrefs = [...new Set([...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1]))];
    const webLinks = hrefs.filter((h) => /^https?:\/\//i.test(h));
    const tagLinks = hrefs.filter((h) => /\{[%{]/.test(h));
    const emptyLinks = hrefs.filter((h) => h === "#" || h === "");
    add(emptyLinks.length === 0, "No empty (#) links", emptyLinks.length ? `${emptyLinks.length} found` : undefined);

    if (check_urls) {
      for (const u of srcs.filter((s) => s.startsWith("https://"))) {
        const s = await urlStatus(u);
        add(s === 200, "Image loads", `${s} ${u}`);
      }
      for (const u of webLinks) {
        const s = await urlStatus(u);
        add(typeof s === "number" && s >= 200 && s < 400, "Link responds", `${s} ${u}`);
      }
    }

    const tags = [...new Set([...html.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)].map((m) => m[0]))];
    const passed = checks.every((c) => c.pass);
    const record = await readRecord(email).catch(() => null);
    if (record) {
      record.lastPrecheck = { at: now(), passed, failed: checks.filter((c) => !c.pass).map((c) => `${c.check}: ${c.detail || ""}`) };
      await writeRecord(email, record);
    }
    return {
      file: path.relative(root, file),
      passed,
      failed: checks.filter((c) => !c.pass),
      checks,
      klaviyo_tags: tags,
      klaviyo_tag_links: tagLinks,
      note: "Klaviyo tags are filled in only when Klaviyo renders or sends the email.",
    };
  }
);

// ---------- client handoff (no client API key) ----------
//
// The email is tested with images hosted in our test Klaviyo account. The same image files are uploaded
// to the client's Klaviyo (by the handler, or by Claude in the handler's logged-in browser) and the new
// links come back here. set_client_klaviyo_account records which account is the client's;
// pack_images_for_client prepares the files; apply_client_image_links checks the links and swaps them in.
// .pipeline/client-images.json remembers images already in each client account, so they're reused.

const MAX_DOWNLOAD = 15 * 1024 * 1024;
const CLIENT_CACHE = ".pipeline/client-images.json";

async function loadClientCache(root) {
  try {
    return JSON.parse(await readFile(path.join(root, CLIENT_CACHE), "utf8"));
  } catch {
    return {};
  }
}

async function saveClientCache(root, cache) {
  await mkdir(path.join(root, ".pipeline"), { recursive: true });
  await writeFile(path.join(root, CLIENT_CACHE), JSON.stringify(cache, null, 2) + "\n");
}

// Account IDs of the test-account images recorded in this project's emails.
async function testAccountIds(root) {
  const ids = new Set();
  let entries = [];
  try {
    entries = await readdir(path.join(root, "emails"), { withFileTypes: true });
  } catch {}
  for (const e of entries.filter((d) => d.isDirectory())) {
    try {
      const r = JSON.parse(await readFile(path.join(root, "emails", e.name, "email.json"), "utf8"));
      for (const url of Object.values(r.klaviyo?.images || {})) {
        const id = accountIdOf(url);
        if (id) ids.add(id);
      }
    } catch {}
  }
  return ids;
}

tool(
  "set_client_klaviyo_account",
  "Record which Klaviyo account is this client's: its account (company) name and its public API key / site ID, as read from the client's Klaviyo (Settings → API keys, \"Public API Key / site ID\" table). Afterwards every client image link must come from this account. Refuses the test account's key.",
  {
    account_name: z.string().min(1).describe("Company Name shown next to the public key"),
    public_key: z
      .string()
      .regex(/^[A-Za-z0-9]{4,12}$/)
      .describe("The public API key / site ID, e.g. AbC123. It's the <id> in https://cdn.klaviyomail.com/company/<id>/..."),
  },
  async ({ account_name, public_key }) => {
    const { root, config } = await requireProject();
    if ((await testAccountIds(root)).has(public_key)) {
      throw new Error(`${public_key} is the test Klaviyo account used for testing in this project, not a client account. Open the client's account and read its key there.`);
    }
    const previous = config.clientKlaviyo || null;
    config.clientKlaviyo = { accountName: account_name, publicKey: public_key, savedAt: now() };
    await writeFile(path.join(root, "pipeline.json"), JSON.stringify(config, null, 2) + "\n");
    return {
      saved: config.clientKlaviyo,
      ...(previous && previous.publicKey !== public_key && { replaced: previous, warning: "This project pointed at a different client account before." }),
    };
  }
);

async function download(url) {
  if (!/^https:\/\//i.test(url)) throw new Error("not an https link");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_DOWNLOAD) throw new Error("larger than 15 MB");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new Error("larger than 15 MB");
  return bytes;
}

const shape = (i) => `${i.format || "unknown type"} ${i.width && i.height ? `${i.width}x${i.height}` : "unknown size"}`;
// Project-relative path with forward slashes, so email.json reads the same on macOS and Windows.
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

tool(
  "pack_images_for_client",
  "After an email passed its Litmus test: copy the images the tested HTML uses into emails/<slug>/handoff/v<version>/images/ for upload to the client's Klaviyo, with an UPLOAD-STEPS.txt for the handler. Images already uploaded to this client's account (remembered from earlier handoffs) are reused instead of packed again. Records which test-account link each image replaces. Refuses if this version has no recorded test or the email was rebuilt after it.",
  {
    email: z.string().describe("Email folder name (slug)"),
    reupload_all: z
      .boolean()
      .default(false)
      .describe("Pack every image, even ones remembered as already in the client's account (use when a remembered link stopped working)"),
  },
  async ({ email, reupload_all }) => {
    const { root, config } = await requireProject();
    const record = await readRecord(email);
    const dir = emailDir(email);
    const html = await readFile(await projectPath(path.join(dir, "build", "email.html")), "utf8");

    const tests = (record.tests || []).filter((t) => t.version === record.version);
    const lastTest = tests[tests.length - 1];
    if (!record.version || !lastTest) {
      throw new Error(`Version ${record.version} of "${email}" has no recorded Litmus test. Test it first (test-email skill), then pack.`);
    }
    if (record.lastBuild?.at && new Date(record.lastBuild.at) > new Date(lastTest.at)) {
      throw new Error(`"${email}" was rebuilt after its last Litmus test (${lastTest.at}). Re-test it, so the client gets exactly what was tested.`);
    }
    if (html.includes("../images/")) {
      throw new Error("The built HTML still uses local images (../images/...). Host them with the test-email skill first.");
    }

    const used = Object.entries(record.klaviyo?.images || {}).filter(([, url]) => url && html.includes(url));
    const usedUrls = new Set(used.map(([, url]) => url));
    const testAccounts = new Set(used.map(([, url]) => accountIdOf(url)).filter(Boolean));
    const inHtml = imageUrlsIn(html).filter((u) => !usedUrls.has(u));
    const strays = inHtml.filter((u) => testAccounts.has(accountIdOf(u)));
    if (strays.length) {
      throw new Error(`These test-account images are in the HTML but not in email.json (klaviyo.images), so I can't tell which file they are: ${strays.join(", ")}`);
    }
    if (!used.length) {
      return { images: 0, note: "This email has no images hosted in the test account, so build/email.html can be imported into the client's Klaviyo as it is." };
    }

    const client = config.clientKlaviyo || null;
    const remembered = client && !reupload_all ? (await loadClientCache(root))[client.publicKey] || {} : {};

    const versionDir = path.join(dir, "handoff", `v${record.version}`);
    const outDir = await projectPath(path.join(versionDir, "images"), { mustExist: false });
    await rm(outDir, { recursive: true, force: true }); // a re-pack starts from an empty folder
    await mkdir(outDir, { recursive: true });
    const packed = [];
    const seen = new Set();
    for (const [file, testUrl] of used) {
      if (seen.has(testUrl)) continue; // the same hosted image listed under two names
      seen.add(testUrl);
      if (path.basename(file) !== file) throw new Error(`email.json klaviyo.images has a path instead of a file name: ${file}`);
      const bytes = await readFile(await projectPath(path.join(dir, "images", file)));
      const info = imageInfo(bytes);
      const packedAs = file.startsWith(`${email}-`) ? file : `${email}-${file}`;
      // Is the local file the one that was tested? Compare it with the test-account copy.
      let testCopy;
      try {
        const hosted = imageInfo(await download(testUrl));
        testCopy =
          hosted.sha256 === info.sha256
            ? "identical"
            : hosted.format === info.format && hosted.width === info.width && hosted.height === info.height
              ? "same-size"
              : "different";
      } catch (e) {
        testCopy = `unreachable (${e.message})`;
      }
      if (testCopy === "different") {
        throw new Error(`images/${file} (${shape(info)}) isn't the image that was tested at ${testUrl}. Re-host it and re-test before packing.`);
      }
      const reuseUrl = remembered[info.sha256]?.url || null;
      if (!reuseUrl) await writeFile(path.join(outDir, packedAs), bytes);
      packed.push({ file, packedAs, testUrl, format: info.format, width: info.width, height: info.height, bytes: info.bytes, sha256: info.sha256, testCopy, reuseUrl });
    }
    const toUpload = packed.filter((p) => !p.reuseUrl);
    const reused = packed.filter((p) => p.reuseUrl);

    const where = client ? `the CLIENT's Klaviyo account "${client.accountName}" (public key ${client.publicKey})` : "the CLIENT's Klaviyo account";
    const stepsFile = await projectPath(path.join(versionDir, "UPLOAD-STEPS.txt"), { mustExist: false });
    await writeFile(
      stepsFile,
      [
        `${config.brand} / ${record.name}, version ${record.version}: images for the client's Klaviyo account`,
        "",
        ...(toUpload.length
          ? [
              `1. In ${where}, open Content > Media & brand > Images and click "Upload images".`,
              `2. In the window that opens, click "Upload settings", choose "Use originals", then "Back".`,
              "   This stops Klaviyo compressing the images, so they stay exactly as tested.",
              `3. Upload all ${toUpload.length} files in the "images" folder next to this note. Keep the file names.`,
              "   The upload starts as soon as the files are chosen.",
              "4. Get each image's link: in the image list, open the image's ... menu and choose Preview.",
              "   The image opens in a new tab. Copy that tab's address (it starts with https://cdn.klaviyomail.com/).",
              "5. Paste all the links into the Claude chat in one message, in any order.",
              "   Claude checks that each link is the right image, then gives you the final HTML to import.",
            ]
          : [`Nothing to upload: every image is already in ${where}.`, "Ask Claude for the final HTML."]),
        ...(reused.length ? ["", `Already in the client's account, reused (${reused.length}): ${reused.map((p) => p.packedAs).join(", ")}`] : []),
        "",
      ].join("\n")
    );

    record.handoff = {
      version: record.version,
      packedAt: now(),
      folder: rel(root, path.dirname(outDir)),
      testedHtmlSha256: sha256(html),
      clientAccount: client?.publicKey || null,
      images: packed,
      clientImages: null,
      finalHtml: null,
    };
    (record.history ||= []).push({
      at: now(),
      note: `Packed ${toUpload.length} images for the client's Klaviyo${reused.length ? `, ${reused.length} reused` : ""} (v${record.version})`,
    });
    await writeRecord(email, record);

    return {
      client_account: client ? `${client.accountName} (${client.publicKey})` : "not recorded yet; set_client_klaviyo_account makes every link get checked against it",
      images_folder: rel(root, outDir),
      steps_for_handler: rel(root, stepsFile),
      to_upload: toUpload.map((p) => ({ file: p.packedAs, image: shape(p), kb: +(p.bytes / 1024).toFixed(1), matches_tested_copy: p.testCopy })),
      ...(reused.length && { already_in_client_account: reused.map((p) => ({ file: p.packedAs, client_link: p.reuseUrl })) }),
      ...(inHtml.length && { hosted_elsewhere_left_as_is: inHtml }),
      next: toUpload.length
        ? "Upload the files in images_folder to the client's Klaviyo (with Use originals), collect their links, then call apply_client_image_links with them."
        : "Nothing to upload. Call apply_client_image_links with no links; the remembered client links are checked and used.",
    };
  }
);

tool(
  "apply_client_image_links",
  "Swap the client's image links into the tested HTML. Pass every image link from the client's Klaviyo (pasted by the handler or read from the image library), in any order: each is downloaded and matched to a packed image by its content. Images reused from earlier uploads are added automatically. Writes emails/<slug>/handoff/v<version>/<slug>-final.html only when every image matched, every link is from the client's account, no test-account link is left, and nothing but the image links changed.",
  {
    email: z.string().describe("Email folder name (slug)"),
    links: z.array(z.string()).max(100).default([]).describe("Every image link from the client's Klaviyo for this email"),
    mapping: z
      .record(z.string(), z.string())
      .optional()
      .describe("Only when automatic matching couldn't decide: {\"<packed file name>\": \"<link>\"}, as the handler says"),
  },
  async ({ email, links, mapping }) => {
    const { root, config } = await requireProject();
    const record = await readRecord(email);
    const h = record.handoff;
    if (!h?.images?.length) throw new Error(`No packed images for "${email}". Run pack_images_for_client first.`);
    if (h.version !== record.version) {
      throw new Error(`The packed images are for version ${h.version}, but the email is now version ${record.version}. Test and pack again.`);
    }
    const dir = emailDir(email);
    const html = await readFile(await projectPath(path.join(dir, "build", "email.html")), "utf8");
    if (sha256(html) !== h.testedHtmlSha256) {
      throw new Error("build/email.html changed after the images were packed. Re-test and pack again, so the client gets exactly what was tested.");
    }

    const remembered = Object.fromEntries(h.images.filter((i) => i.reuseUrl).map((i) => [i.packedAs, i.reuseUrl]));
    const explicit = { ...remembered, ...(mapping || {}) };
    const urls = [...new Set([...links, ...Object.values(explicit)].map((u) => u.trim()).filter(Boolean))];
    if (!urls.length) throw new Error("No links given. Pass the links of the images uploaded to the client's Klaviyo.");
    const notHttps = urls.filter((u) => !/^https:\/\/\S+$/i.test(u));
    if (notHttps.length) throw new Error(`These aren't https links: ${notHttps.join(", ")}`);
    const testIds = new Set(h.images.map((i) => accountIdOf(i.testUrl)).filter(Boolean));
    const fromTest = urls.filter((u) => h.images.some((i) => i.testUrl === u) || testIds.has(accountIdOf(u)));
    if (fromTest.length) {
      throw new Error(`These links are from the test Klaviyo account, not the client's. Take them from the client's account: ${fromTest.join(", ")}`);
    }
    const client = config.clientKlaviyo || null;
    if (client) {
      const foreign = urls.filter((u) => accountIdOf(u) !== client.publicKey);
      if (foreign.length) {
        throw new Error(
          `These links aren't from ${client.accountName}'s Klaviyo account (public key ${client.publicKey}). Check the right account is open, then take the links from there: ${foreign.join(", ")}`
        );
      }
    }

    const fetched = [];
    const failedDownloads = [];
    for (const url of urls) {
      try {
        fetched.push({ url, ...imageInfo(await download(url)) });
      } catch (e) {
        failedDownloads.push(`${url}: ${e.message}`);
      }
    }
    const m = matchLinks(h.images, fetched, explicit);
    const clientAccounts = [...new Set(m.matches.map((x) => accountIdOf(x.clientUrl)).filter(Boolean))];
    if (clientAccounts.length > 1) m.problems.push(`The links come from ${clientAccounts.length} different Klaviyo accounts (${clientAccounts.join(", ")}). They should all be from the client's one account.`);

    // A remembered link that no longer works or no longer matches is forgotten, so the next pack includes that image.
    const stale = Object.entries(remembered).filter(([packedAs, url]) => !m.matches.some((x) => x.packedAs === packedAs && x.clientUrl === url));
    const cache = await loadClientCache(root);
    if (stale.length) {
      for (const [packedAs] of stale) {
        const img = h.images.find((i) => i.packedAs === packedAs);
        for (const acct of Object.keys(cache)) delete cache[acct]?.[img.sha256];
      }
      await saveClientCache(root, cache);
    }

    if (failedDownloads.length || m.problems.length || m.unmatchedFiles.length) {
      return {
        final_html: null,
        matched: m.matches.map((x) => ({ file: x.packedAs, client_link: x.clientUrl, check: x.how })),
        ...(m.unmatchedFiles.length && { no_link_found_for: m.unmatchedFiles }),
        ...(m.unusedLinks.length && { links_that_matched_no_image: m.unusedLinks }),
        ...(failedDownloads.length && { links_that_did_not_load: failedDownloads }),
        ...(m.problems.length && { problems: m.problems }),
        ...(stale.length && {
          forgotten: `These images were remembered as already in the client's account, but their links failed: ${stale.map(([f]) => f).join(", ")}. Run pack_images_for_client again; they'll be packed for upload.`,
        }),
        next: "Nothing was written. Get the missing or wrong links (name the files), then call again with all links, plus `mapping` for any matched by name.",
      };
    }

    const swap = swapLinks(
      html,
      m.matches.map(({ testUrl, clientUrl }) => ({ testUrl, clientUrl }))
    );
    if (swap.leftovers.length) throw new Error(`Test-account links are still in the HTML after the swap: ${swap.leftovers.join(", ")}`);
    if (!swap.onlyLinksChanged) throw new Error("The swap would change more than the image links, so nothing was written. Check the email by hand.");

    const finalFile = await projectPath(path.join(dir, "handoff", `v${h.version}`, `${email}-final.html`), { mustExist: false });
    await writeFile(finalFile, swap.html);

    // Remember these images for this client, so later emails reuse them instead of uploading again.
    for (const x of m.matches) {
      const acct = accountIdOf(x.clientUrl);
      const img = h.images.find((i) => i.packedAs === x.packedAs);
      if (!acct || !img) continue;
      (cache[acct] ||= {})[img.sha256] = { url: x.clientUrl, name: x.packedAs, at: now() };
    }
    await saveClientCache(root, cache);

    record.handoff = {
      ...h,
      clientImages: Object.fromEntries(m.matches.map((x) => [x.packedAs, x.clientUrl])),
      clientAccount: clientAccounts[0] || null,
      finalHtml: rel(root, finalFile),
      finalHtmlSha256: sha256(swap.html),
      finalizedAt: now(),
    };
    (record.history ||= []).push({ at: now(), note: `Final HTML with the client's image links written (v${h.version})` });
    await writeRecord(email, record);

    const recompressed = m.matches.filter((x) => x.how === "same-size");
    return {
      final_html: rel(root, finalFile),
      client_account: client ? `${client.accountName} (${client.publicKey})` : clientAccounts[0] || null,
      only_image_links_changed: true,
      images: m.matches.map((x) => ({
        file: x.packedAs,
        client_link: x.clientUrl,
        check: x.how === "identical" ? "same file as tested" : "re-compressed by Klaviyo: same type and pixel size, different bytes",
        ...(remembered[x.packedAs] === x.clientUrl && { reused: true }),
        replaced: swap.counts[x.testUrl],
      })),
      ...(m.unusedLinks.length && { links_that_matched_no_image: m.unusedLinks }),
      ...(recompressed.length && {
        note: `${recompressed.length} image(s) were re-compressed by Klaviyo ("Use originals" wasn't chosen). The layout can't change (same pixel size), but sharpness might: re-upload them with Use originals, or take a quick Litmus look.`,
      }),
    };
  }
);

// ---------- design outline ----------

// Figma results can be megabytes. This turns a saved figma_get_component_for_development_deep
// result into a compact outline. Reads JSON only, from the project or Claude's own tool-result store.
async function readableDesignFile(p) {
  const real = await realpath(path.resolve(p));
  const root = await projectRoot();
  const claudeProjects = await realpath(path.join(homedir(), ".claude", "projects")).catch(() => null);
  const inside = (base) => base && (real === base || real.startsWith(base + path.sep));
  if (!inside(root) && !inside(claudeProjects)) {
    throw new Error("Design files can only be read from the project folder or Claude's saved tool results.");
  }
  return real;
}

const hex = (fills) =>
  (fills || [])
    .map((f) =>
      f.type === "SOLID" && f.color
        ? "#" + [f.color.r, f.color.g, f.color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
        : f.type
    )
    .join("+");

tool(
  "summarize_design",
  "Turn a saved Figma deep-component result (JSON) into a compact outline: frames with size, auto-layout padding/gap, fills and radius; image nodes with IDs to export; text (or text converted to outlines, which is flagged). Use it when the Figma result is too large to read directly.",
  {
    file_path: z.string().describe("Absolute path of the saved Figma result file"),
    max_lines: z.number().int().min(50).max(1500).default(400),
  },
  async ({ file_path, max_lines }) => {
    const file = await readableDesignFile(file_path);
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new Error("That file isn't JSON from a Figma result.");
    }
    const rootNode = data.component || data.node || data;
    if (!rootNode || !rootNode.type) throw new Error("No Figma node found in that file.");
    const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
    const isImage = (n) => (n.fills || []).some((f) => f.type === "IMAGE");
    // Vector-only groups are illustrations or outlined text; image-filled shapes are never collapsed.
    const onlyArt = (n) =>
      (n.type === "VECTOR" && !isImage(n)) || ((n.type === "GROUP" || n.type === "FRAME") && !isImage(n) && (n.children || []).every(onlyArt));
    const firstFill = (n) => (n.type === "VECTOR" ? hex(n.fills) : (n.children || []).map(firstFill).find(Boolean) || "");
    const lines = [];
    const images = [];
    let outlinedText = 0;
    let liveText = 0;
    (function walk(n, d) {
      if (lines.length >= max_lines) return;
      const kids = n.children || [];
      // Auto-layout frames are layout structure (rows, buttons, cards), so they always expand.
      const autoLayout = n.type === "FRAME" && n.layoutMode && n.layoutMode !== "NONE";
      const art = d >= 2 && !autoLayout && onlyArt(n) && count(n) > 3;
      const hasImage = (n.fills || []).some((f) => f.type === "IMAGE");
      if (hasImage) images.push({ id: n.id, name: n.name, size: `${Math.round(n.width)}x${Math.round(n.height)}` });
      const layout =
        n.layoutMode && n.layoutMode !== "NONE"
          ? ` ${n.layoutMode} pad[${n.paddingTop ?? 0},${n.paddingRight ?? 0},${n.paddingBottom ?? 0},${n.paddingLeft ?? 0}] gap${n.itemSpacing ?? 0}`
          : "";
      const radius = n.cornerRadius ? ` r${n.cornerRadius}` : "";
      const opacity = n.opacity != null && n.opacity < 1 ? ` op${Math.round(n.opacity * 100) / 100}` : "";
      let extra = "";
      if (n.type === "TEXT") {
        liveText++;
        const font = n.fontName ? ` ${n.fontName.family || ""} ${n.fontName.style || ""}`.trimEnd() : "";
        extra = ` TEXT${font}${n.fontSize ? " " + n.fontSize + "px" : ""} "${String(n.characters || "").slice(0, 120)}"`;
      } else if (art) {
        const isText = n.type === "GROUP" && n.name !== "Group" && kids.every((c) => c.type === "VECTOR");
        if (isText) outlinedText++;
        extra = isText ? ` [TEXT AS OUTLINES, color ${firstFill(n)}]` : ` [illustration, ${count(n)} nodes, color ${firstFill(n)}]`;
      }
      lines.push(
        `${"  ".repeat(d)}${n.type} ${n.id} "${String(n.name).slice(0, 100)}" ${Math.round(n.width)}x${Math.round(n.height)}${layout}${radius} fill:${hex(n.fills)}${opacity}${hasImage ? " IMAGE" : ""}${n.visible === false ? " HIDDEN" : ""}${extra}`
      );
      if (!art) kids.forEach((k) => walk(k, d + 1));
    })(rootNode, 0);
    return {
      outline: lines.join("\n"),
      truncated: lines.length >= max_lines,
      image_nodes: images,
      live_text_nodes: liveText,
      text_as_outlines_groups: outlinedText,
      note:
        outlinedText > 0 && liveText === 0
          ? "All text is converted to outlines, so fonts and sizes must be inferred from the screenshot. Tell the user."
          : undefined,
    };
  }
);

await server.connect(new StdioServerTransport());
