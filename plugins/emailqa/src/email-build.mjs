#!/usr/bin/env node
// EmailQA build server: setup, workspace and clients, email folders, files and images, MJML compile,
// pre-checks and local preview. Works the same on macOS and Windows; skills never need shell commands.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import mjml2html from "mjml";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { VERSION, deepMerge, envValue, now, readJson, registerTools, slugify, writeJson } from "./lib/common.mjs";
import {
  assertSafeWorkspacePath,
  canBeWorkspace,
  checkClientSlug,
  claudeDir,
  clientFigmaKeys,
  defaultWorkspacePath,
  emailDir,
  emailFile,
  emailPathFromName,
  figmaFileEntries,
  figmaFileKey,
  findEmails,
  findWorkspace,
  isAllowedRecipient,
  isInside,
  listClientSlugs,
  litmusBases,
  pluginRoot,
  requireClient,
  requireEmail,
  requireWorkspace,
  saveRecord,
  sessionFolder,
  updateMachine,
  within,
  writeClient,
} from "./lib/workspace.mjs";
import { runSetupChecks } from "./lib/setup-checks.mjs";
import { installFigmaRuntime, prepareBridgeManifest } from "./lib/figma-runtime.mjs";
import { cropImage, imageInfo, liftBlacks, pngToJpg } from "./lib/images.mjs";
import { DARK_MODES, simulateDark } from "./lib/dark-sim.mjs";
// imageInfo here reads a file path; the handoff one fingerprints bytes (format, size, SHA-256).
import { accountIdOf, imageInfo as fileFingerprint, imageUrlsIn, matchLinks, sha256, swapLinks } from "./lib/handoff.mjs";
import { checkContrast } from "./lib/contrast.mjs";
import { ensurePreviewServer, openInBrowser, previewUrls } from "./lib/preview.mjs";
import { summarize } from "./lib/design.mjs";
import { CLIENT_BEHAVIOR, KINDS, addLessons, loadLessons, matchClientBehavior, matchLessons } from "./lib/lessons.mjs";
import { checkPlanItems, checkPlanResults, lessonEntries, openProblems, pendingPlan } from "./lib/plans.mjs";
import { resolveVariants, summarizeVariants } from "./lib/variants.mjs";

const server = new McpServer({ name: "email-build", version: VERSION });
const tool = registerTools(server);

const clientArg = z.string().describe('Client folder name, e.g. "acme" (see list_clients)');
const emailArg = z.string().describe('Email folder path inside the client\'s emails/, e.g. "spring-sale" or "black-friday/teaser"');

// ---------- setup ----------

tool(
  "setup_status",
  "First-run and health check for this computer: Node, duplicate plugin copies, a second Figma server, the Figma server install, Figma bridge files, Litmus test address and the workspace. Read-only. Each failed check has a fix.",
  {},
  async () => runSetupChecks()
);

tool(
  "install_figma_server",
  "Install the pinned Figma server (figma-console-mcp) into this plugin's data folder on this computer. Needs internet once; takes up to a minute. Afterwards a new Claude session is needed for the Figma tools to load.",
  {},
  async () => {
    const status = await installFigmaRuntime();
    await updateMachine({ figmaServer: status.installed, figmaServerInstalledAt: now() });
    return { installed: true, ...status, next: "Start a new Claude session so the Figma tools load, then run /emailqa:start again." };
  }
);

tool(
  "prepare_figma_bridge",
  "Create the Figma Desktop Bridge plugin files on this computer and return the manifest path and the import steps for this OS.",
  {},
  async () => {
    const manifest = await prepareBridgeManifest();
    const mac = process.platform === "darwin";
    return {
      manifest,
      steps: [
        "Open Figma Desktop (the app, not the browser) and open the design file.",
        "Menu: Plugins → Development → Import plugin from manifest…",
        mac
          ? `In the file dialog press ⌘⇧G, paste ${manifest} and press Enter, then Open. (The folder is hidden, so it won't show up by browsing.)`
          : `In the file dialog paste ${manifest} into the File name box and press Enter.`,
        "Run it: right-click the canvas → Plugins → Development → Figma Desktop Bridge. Its panel turns green and shows READY.",
        "Importing is once per computer (and possibly once per Figma account). Running it is needed in each file, each time the file is opened.",
      ],
    };
  }
);

tool(
  "create_workspace",
  `Make a folder the EmailQA workspace: adds workspace.json, clients/ and library/ (seeded with the shared defaults) and never touches other files there. Defaults to the folder Claude is opened in (this session's folder), so client projects live where the user opened Claude. Falls back to ${defaultWorkspacePath()} only when the session folder is the home folder or a drive root. Safe to call without asking.`,
  { path: z.string().optional().describe("Absolute folder path. Leave out to use this session's folder.") },
  async ({ path: p }) => {
    const session = sessionFolder();
    const target = path.resolve(p || ((await canBeWorkspace(session)) ? session : defaultWorkspacePath()));
    await assertSafeWorkspacePath(target); // check before creating anything
    await mkdir(target, { recursive: true });
    const ws = await assertSafeWorkspacePath(target);
    const wsFile = path.join(ws, "workspace.json");
    const existed = existsSync(wsFile);
    let otherFiles = 0;
    if (!existed) {
      otherFiles = (await readdir(ws)).filter((n) => !n.startsWith(".")).length;
      await writeJson(wsFile, { name: path.basename(ws), templatePrefix: "[TEST] ", created: now(), createdWith: `EmailQA ${VERSION}` });
    }
    await mkdir(path.join(ws, "clients"), { recursive: true });
    const seeded = [];
    const libSrc = path.join(pluginRoot(), "library");
    await mkdir(path.join(ws, "library"), { recursive: true });
    for (const f of await readdir(libSrc).catch(() => [])) {
      // client-behavior.md is reference data the plugin keeps current; find_lessons reads the plugin's copy.
      if (f === CLIENT_BEHAVIOR) continue;
      const dest = path.join(ws, "library", f);
      if (!existsSync(dest)) {
        await copyFile(path.join(libSrc, f), dest);
        seeded.push(f);
      }
    }
    await updateMachine({ workspace: ws });
    const sessionIsWorkspace = isInside(ws, await realpath(sessionFolder()).catch(() => sessionFolder()));
    return {
      workspace: ws,
      created: !existed,
      ...(otherFiles > 0 && { kept_existing_files: otherFiles }),
      library_files_added: seeded,
      session_is_in_workspace: sessionIsWorkspace,
      ...(!sessionIsWorkspace && {
        next: `This session is open in ${sessionFolder()}. Open future sessions in ${ws} (desktop app: choose that folder before the first message).`,
      }),
    };
  }
);

tool("mark_setup_done", "Record that first-run setup finished on this computer.", { notes: z.string().optional() }, async ({ notes }) =>
  updateMachine({ setupDone: true, setupVersion: VERSION, setupAt: now(), ...(notes && { setupNotes: notes }) })
);

// ---------- clients ----------

tool("list_clients", "List the clients in the workspace with their Figma files, Litmus folder address and email count.", {}, async () => {
  const { ws, config } = await requireWorkspace();
  const clients = [];
  for (const slug of await listClientSlugs(ws)) {
    const c = await readJson(path.join(ws, "clients", slug, "client.json"));
    clients.push({
      client: slug,
      name: c.name,
      figma_files: c.figma?.files || [],
      litmus_address: c.litmus?.address || null,
      client_klaviyo: c.clientKlaviyo ? { account_name: c.clientKlaviyo.accountName, public_key: c.clientKlaviyo.publicKey } : null,
      emails: (await findEmails(path.join(ws, "clients", slug))).length,
    });
  }
  return { workspace: ws, template_prefix: config.templatePrefix || "[TEST] ", clients };
});

function checkLitmusAddress(addr) {
  if (addr == null || addr === "") return null;
  const a = String(addr).trim().toLowerCase();
  if (!isAllowedRecipient(a)) {
    const bases = litmusBases();
    throw new Error(
      bases.length
        ? `${a} must be your Litmus address or one of its +folder variants (${bases.map((b) => b.replace("@", "+…@")).join(", ")}).`
        : "Set your Litmus test address in the plugin settings first."
    );
  }
  return a;
}

tool(
  "new_client",
  "Create a client folder in the workspace: client.json, brand/, emails/. One folder per client.",
  {
    name: z.string().describe('Client or brand name, e.g. "Acme Outdoors"'),
    folder: z.string().optional().describe("Folder name; defaults to a slug of the name"),
    figma_file_urls: z.array(z.string()).optional().describe("Figma file URLs this client's designs live in"),
    litmus_address: z.string().optional().describe("Optional: the Litmus folder test address for this client (name+code@litmusemail.com)"),
    notes: z.string().optional(),
  },
  async ({ name, folder, figma_file_urls, litmus_address, notes }) => {
    const { ws } = await requireWorkspace();
    const slug = checkClientSlug(folder || slugify(name));
    const dir = path.join(ws, "clients", slug);
    if (existsSync(path.join(dir, "client.json"))) {
      return { created: false, client: slug, config: await readJson(path.join(dir, "client.json")), note: "Client already exists." };
    }
    const config = {
      name,
      client: slug,
      created: now(),
      figma: { files: figmaFileEntries(figma_file_urls || []) },
      litmus: { address: checkLitmusAddress(litmus_address) },
      notes: notes || "",
    };
    for (const sub of ["brand", "emails", ".cache"]) await mkdir(path.join(dir, sub), { recursive: true });
    await writeClient(dir, config);
    return { created: true, client: slug, folder: dir, config };
  }
);

tool(
  "update_client",
  "Change a client's settings: name, Figma files, Litmus folder address, notes.",
  {
    client: clientArg,
    name: z.string().optional(),
    add_figma_file_urls: z.array(z.string()).optional(),
    remove_figma_file_keys: z.array(z.string()).optional(),
    litmus_address: z.string().nullable().optional().describe("null or empty clears it"),
    notes: z.string().optional(),
  },
  async ({ client, name, add_figma_file_urls, remove_figma_file_keys, litmus_address, notes }) => {
    const c = await requireClient(client);
    const config = c.config;
    if (name) config.name = name;
    if (notes !== undefined) config.notes = notes;
    config.figma ||= { files: [] };
    if (add_figma_file_urls?.length) {
      for (const f of figmaFileEntries(add_figma_file_urls)) {
        if (!config.figma.files.some((x) => x.fileKey === f.fileKey)) config.figma.files.push(f);
      }
    }
    if (remove_figma_file_keys?.length) config.figma.files = config.figma.files.filter((f) => !remove_figma_file_keys.includes(f.fileKey));
    if (litmus_address !== undefined) config.litmus = { address: checkLitmusAddress(litmus_address) };
    config.updated = now();
    await writeClient(c.dir, config);
    return { client, config };
  }
);

tool(
  "check_figma_file",
  "Check that a Figma file (URL or file key, e.g. from figma_get_status or figma_list_open_files) belongs to this client before reading designs from it.",
  { client: clientArg, file: z.string().describe("Figma file URL or file key") },
  async ({ client, file }) => {
    const c = await requireClient(client);
    const key = figmaFileKey(file);
    const allowed = clientFigmaKeys(c.config);
    if (!key) throw new Error(`Not a Figma file URL or key: ${file}`);
    if (!allowed.includes(key)) {
      throw new Error(
        `Figma file ${key} isn't one of ${c.config.name}'s files (${allowed.join(", ") || "none listed"}). ` +
          "Make sure the right file is open, or if it really belongs to this client, add it with update_client (ask the user first)."
      );
    }
    return { ok: true, client, file_key: key };
  }
);

tool(
  "import_old_project",
  "Copy an old Email Template Tester project (a folder with pipeline.json and emails/) into the workspace as a client. The old folder is left untouched.",
  { path: z.string().describe("Absolute path of the old project folder"), client_name: z.string().optional() },
  async ({ path: oldPath, client_name }) => {
    const { ws } = await requireWorkspace();
    const old = await realpath(path.resolve(oldPath));
    const pipeline = await readJson(path.join(old, "pipeline.json")).catch(() => null);
    if (!pipeline) throw new Error(`${old} has no pipeline.json, so it isn't an old Email Template Tester project.`);
    const name = client_name || pipeline.brand || path.basename(old);
    const slug = checkClientSlug(slugify(name));
    const dir = path.join(ws, "clients", slug);
    if (!existsSync(path.join(dir, "client.json"))) {
      for (const sub of ["brand", "emails", ".cache"]) await mkdir(path.join(dir, sub), { recursive: true });
      await writeClient(dir, {
        name,
        client: slug,
        created: now(),
        figma: { files: pipeline.figmaFile ? figmaFileEntries([pipeline.figmaFile]) : [] },
        litmus: { address: null },
        ...(pipeline.clientKlaviyo && { clientKlaviyo: pipeline.clientKlaviyo }),
        notes: `Imported from ${old}`,
      });
    }
    const copied = [];
    const skipped = [];
    for (const e of await readdir(path.join(old, "emails"), { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const src = path.join(old, "emails", e.name);
      const dest = path.join(dir, "emails", slugify(e.name));
      if (existsSync(dest) || !existsSync(path.join(src, "email.json"))) {
        skipped.push(e.name);
        continue;
      }
      await cp(src, dest, { recursive: true, filter: (s) => path.basename(s) !== ".claude" && path.basename(s) !== ".DS_Store" });
      const recFile = path.join(dest, "email.json");
      const rec = await readJson(recFile);
      rec.client = slug;
      rec.path = slugify(e.name);
      rec.figma = { ...(rec.figma || {}), fileKey: figmaFileKey(rec.figma?.fileUrl) || null };
      rec.klaviyo = { supersededImages: [], ...(rec.klaviyo || {}) };
      (rec.history ||= []).push({ at: now(), note: `Imported into EmailQA from ${src}` });
      await writeJson(recFile, rec);
      copied.push(rec.path);
    }
    const oldCache = await readJson(path.join(old, ".pipeline", "klaviyo-images.json"), {});
    if (Object.keys(oldCache).length) {
      const cacheFile = path.join(dir, ".cache", "klaviyo-images.json");
      const cache = await readJson(cacheFile, {});
      for (const [fp, entries] of Object.entries(oldCache)) cache[fp] = { ...(entries || {}), ...(cache[fp] || {}) };
      await writeJson(cacheFile, cache);
    }
    // Images already uploaded to the client's own Klaviyo (handoff), keyed by the client's public key.
    const oldClientImages = await readJson(path.join(old, ".pipeline", "client-images.json"), {}).catch(() => ({}));
    if (Object.keys(oldClientImages).length) {
      const file = clientCacheFile(dir);
      const cache = await readJson(file, {}).catch(() => ({}));
      for (const [acct, images] of Object.entries(oldClientImages)) cache[acct] = { ...(images || {}), ...(cache[acct] || {}) };
      await writeJson(file, cache);
    }
    return { client: slug, folder: dir, emails_copied: copied, emails_skipped: skipped, old_folder_untouched: old };
  }
);

// ---------- emails ----------

tool(
  "new_email",
  "Create the folder and record for one email: clients/<client>/emails/[<group>/]<name>/ with design/, images/, build/, qa/. Returns the existing record if it exists.",
  {
    client: clientArg,
    name: z.string().describe('Human name, e.g. "Spring sale". The folder name is derived from it.'),
    group: z.string().optional().describe('Optional subfolder to group emails, e.g. "black-friday"'),
    figma_url: z.string().optional(),
    figma_node_id: z.string().optional().describe("e.g. 1:4909"),
  },
  async ({ client, name, group, figma_url, figma_node_id }) => {
    const c = await requireClient(client);
    const rel = emailPathFromName(name, group);
    const dir = await emailDir(c.dir, rel);
    // An email folder can't sit inside another email folder.
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (existsSync(path.join(c.dir, "emails", ...parts.slice(0, i), "email.json"))) {
        throw new Error(`"${parts.slice(0, i).join("/")}" is an email, not a group folder. Pick another group name.`);
      }
    }
    const recordFile = path.join(dir, "email.json");
    if (existsSync(recordFile)) return { created: false, email: rel, folder: dir, record: await readJson(recordFile) };
    for (const sub of ["design", "images", "build", "qa"]) await mkdir(path.join(dir, sub), { recursive: true });
    const fileUrl = figma_url || c.config.figma?.files?.[0]?.url || null;
    const record = {
      name,
      client,
      path: rel,
      created: now(),
      figma: { fileUrl, fileKey: figmaFileKey(fileUrl), nodeId: figma_node_id || null },
      version: 0,
      klaviyo: { templateId: null, templateName: null, images: {}, supersededImages: [] },
      testValues: [],
      tests: [],
      history: [{ at: now(), note: "Email created" }],
    };
    await writeJson(recordFile, record);
    return { created: true, email: rel, folder: dir, record };
  }
);

tool("list_emails", "List a client's emails with version, Klaviyo template and latest test.", { client: clientArg }, async ({ client }) => {
  const c = await requireClient(client);
  const emails = [];
  for (const rel of await findEmails(c.dir)) {
    try {
      const r = await readJson(path.join(c.dir, "emails", ...rel.split("/"), "email.json"));
      const last = r.tests?.[r.tests.length - 1];
      emails.push({
        email: rel,
        name: r.name,
        version: r.version,
        klaviyo_template: r.klaviyo?.templateId || null,
        test_values_in_place: (r.testValues || []).length,
        last_test: last ? { at: last.at, version: last.version, alerts: last.alerts, findings: last.findings?.length ?? null, open_problems: openProblems(last).length } : null,
        client_handoff: r.handoff ? { version: r.handoff.version, final_html: r.handoff.finalHtml || null } : null,
      });
    } catch {
      emails.push({ email: rel, note: "email.json unreadable" });
    }
  }
  return { client, name: c.config.name, folder: c.dir, emails };
});

tool(
  "update_email_record",
  'Update an email\'s record (email.json): deep-merge `patch`, optionally append one test result to `tests`, and add a history note. A test recorded after a fix plan (plan_fixes) must carry plan_results, one entry per fix; each result is also written to the workspace\'s library/lessons.md.',
  {
    client: clientArg,
    email: emailArg,
    patch: z.record(z.string(), z.any()).optional(),
    add_test: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        'e.g. {"litmus_email_id":"12345678","alerts":1,"findings":[...],"open":["Gmail App Dark: band text pale green"],"plan_results":[{"item":1,"result":"failed","evidence":"qa/v3/gmailapp-dark-band.jpg: text still pale green"},{"item":2,"result":"worked","evidence":"…","variants":[{"id":"A","result":"failed"},{"id":"B","result":"worked"}]}]}. `open` lists the problems in our email that are still open after this round (empty list when none).'
      ),
    note: z.string().optional(),
  },
  async ({ client, email, patch, add_test, note }) => {
    const e = await requireEmail(client, email);
    const record = e.record;
    let lessonsWritten = 0;
    if (add_test) {
      const pending = pendingPlan(record);
      if (pending) {
        const errors = checkPlanResults(pending, add_test.plan_results);
        if (errors.length) throw new Error(`Record what happened to each fix in the plan first:\n- ${errors.join("\n- ")}`);
        const where = `${client}/${e.email} v${record.version ?? "?"}, ${now().slice(0, 10)}`;
        lessonsWritten = await addLessons(e.ws, lessonEntries(pending, add_test.plan_results, where));
      }
    }
    if (patch) deepMerge(record, patch);
    if (add_test) (record.tests ||= []).push({ at: now(), version: record.version, ...add_test });
    if (note) (record.history ||= []).push({ at: now(), note });
    await saveRecord(e.recordFile, record);
    // A short acknowledgment: the full record is about 100 lines and fills the context over a session.
    return {
      saved: true,
      version: record.version ?? null,
      changed: [...(patch ? Object.keys(patch) : []), ...(add_test ? ["tests"] : []), ...(note ? ["history"] : [])],
      tests: (record.tests || []).length,
      ...(add_test && { open_problems: openProblems(record.tests[record.tests.length - 1]).length }),
      ...(lessonsWritten && { lessons_written: lessonsWritten }),
    };
  }
);

const clientAppsArg = z.array(z.string().min(2)).min(1).describe('Client apps that show the problem, e.g. ["Gmail App Dark Android 15"]');

tool(
  "find_lessons",
  "Search the workspace's library/lessons.md (team lessons and the fix log, including fixes that failed) and library/client-behavior.md (what each email client does in dark mode, documented fixes and their sources) for a problem. Use the client app and the symptom as the query, for example 'Outlook 2021 dark mode white text'. Read the matches before you plan a fix.",
  { query: z.string().min(3), limit: z.number().int().min(1).max(20).default(8) },
  async ({ query, limit }) => {
    const { ws } = await requireWorkspace();
    const matches = matchLessons(await loadLessons(ws), query, { limit });
    const client_behavior = await matchClientBehavior(ws, query, { limit: Math.min(limit, 6) });
    return {
      query,
      matches,
      client_behavior,
      ...(matches.length + client_behavior.length === 0 && { note: "Nothing recorded for this yet. Search the web for the cause, and record the result with plan_fixes and update_email_record." }),
    };
  }
);

tool(
  "plan_fixes",
  "Write the fix plan for the problems the last Litmus review found, before changing anything. For each problem give the cause, where the cause comes from, the fix and how the next round proves it. A second or later Litmus send is refused without a plan. If the cause is not known, test two or more fixes as variants side by side in one round (variant_group and variants). Returns lessons that match, and refuses a fix that already failed unless why_different says what is different.",
  {
    client: clientArg,
    email: emailArg,
    items: z
      .array(
        z.object({
          problem: z.string().describe("The problem and the client app, as the review found it"),
          clients: clientAppsArg,
          cause: z.string().describe("Why the client shows this (a mechanism, not a repeat of the symptom)"),
          source: z.string().describe("Where the cause comes from: a lessons.md line, a URL, a screenshot path, or what you measured. 'none' only with variants."),
          fix: z.string().describe("The change you will make"),
          proof: z.string().describe("What the next round must show for the fix to count, for example 'qa/v4/gmailapp-dark-band.jpg: band text dark green'"),
          variant_group: z.string().optional().describe("Group name used in <!-- variant <group> <id> --> blocks in email.mjml"),
          variants: z.array(z.string()).optional().describe('One line per variant: "A: control, unchanged", "B: band text as an image"'),
          why_different: z.string().optional().describe("Required when the fix looks like one that already failed (see find_lessons)"),
        })
      )
      .min(1)
      .max(8),
  },
  async ({ client, email, items }) => {
    const e = await requireEmail(client, email);
    const lessons = await loadLessons(e.ws);
    const errors = checkPlanItems(items, lessons);
    if (errors.length) throw new Error(`The plan is not ready:\n- ${errors.join("\n- ")}`);
    (e.record.plans ||= []).push({ at: now(), version: e.record.version ?? null, items });
    (e.record.history ||= []).push({ at: now(), note: `Fix plan: ${items.length} item(s)` });
    await saveRecord(e.recordFile, e.record);
    const related = [];
    for (const it of items) {
      const q = `${it.problem} ${it.clients.join(" ")}`;
      related.push({ problem: it.problem, lessons: matchLessons(lessons, q, { limit: 4 }), client_behavior: await matchClientBehavior(e.ws, q, { limit: 3 }) });
    }
    return {
      saved: true,
      items: items.length,
      related_lessons: related,
      next: items.some((i) => i.variant_group)
        ? "Add the variant blocks to email.mjml (a visible label row in each), compile_email, upsert_template, send. After the review, record plan_results, then resolve_variants."
        : "Make the fixes, compile_email, upsert_template, send. After the review, record plan_results with update_email_record.",
    };
  }
);

tool(
  "record_lesson",
  "Add one line to the fix log in the workspace's library/lessons.md. update_email_record writes these for every fix in a plan, so call this only for something learned outside a plan: a cause found, a fix that worked in a real client, or an idea worth trying later (kind idea).",
  {
    kind: z.enum(KINDS),
    clients: z.string().min(2).describe('Client apps, e.g. "Gmail App Dark" or "Outlook 2021, Outlook 365 Dark"'),
    problem: z.string().min(8),
    fix: z.string().min(4),
    cause: z.string().optional(),
    evidence: z.string().optional().describe("A URL, a screenshot path or what was measured"),
    client: z.string().optional(),
    email: z.string().optional(),
  },
  async ({ kind, clients, problem, fix, cause, evidence, client, email }) => {
    const { ws } = await requireWorkspace();
    let where = now().slice(0, 10);
    if (client && email) {
      const e = await requireEmail(client, email);
      where = `${client}/${e.email} v${e.record.version ?? "?"}, ${where}`;
    }
    const added = await addLessons(ws, [{ kind, clients, problem, fix, cause, evidence, where }]);
    return { saved: added === 1, ...(added === 0 && { note: "The same line is already in lessons.md." }) };
  }
);

tool(
  "resolve_variants",
  "Keep one test variant of a group and delete the others (and the label rows) from email.mjml. Call it after the Litmus review shows which variant works. Then compile_email and test the result: the client gets only a version that was tested exactly as it is, and one confirm round is allowed after this call.",
  {
    client: clientArg,
    email: emailArg,
    group: z.string().describe("The variant group name"),
    keep: z.string().describe("The variant id to keep, for example B"),
  },
  async ({ client, email, group, keep }) => {
    const e = await requireEmail(client, email);
    const file = path.join(e.emailDir, "email.mjml");
    const text = await readFile(file, "utf8").catch(() => {
      throw new Error("No email.mjml in this email's folder.");
    });
    const res = resolveVariants(text, group, keep);
    await writeFile(file, res.text);
    const left = summarizeVariants(res.text);
    const vr = (e.record.variantResolution ||= { groups: [] });
    vr.at = now();
    vr.confirmUsed = false;
    if (!vr.groups.includes(group)) vr.groups.push(group);
    (e.record.history ||= []).push({ at: now(), note: `Variants "${group}" resolved: kept ${keep}, removed ${res.removed.join(", ")}` });
    await saveRecord(e.recordFile, e.record);
    return {
      group,
      kept: keep,
      removed: res.removed,
      groups_left: left.groups.map((g) => g.group),
      next: left.groups.length
        ? `Other variant groups are still in the email: ${left.groups.map((g) => g.group).join(", ")}. Resolve them too.`
        : "Run compile_email, precheck_email, upsert_template and send the confirm round.",
    };
  }
);

tool(
  "set_test_values",
  "Record the fake values used only for testing (sample links, a sample postal address, etc.). The pre-check warns while any of them are still in the email, so they get replaced before a real send.",
  {
    client: clientArg,
    email: emailArg,
    values: z
      .array(z.object({ label: z.string(), value: z.string().min(3) }))
      .optional()
      .describe('e.g. [{"label":"Footer address","value":"100 Sample Street"},{"label":"Social links","value":"https://example.com/social"}]'),
    clear: z.boolean().default(false).describe("Remove all recorded test values (after the real values are in)"),
  },
  async ({ client, email, values, clear }) => {
    const e = await requireEmail(client, email);
    if (clear) e.record.testValues = [];
    for (const v of values || []) {
      if (!(e.record.testValues ||= []).some((x) => x.value === v.value)) e.record.testValues.push({ ...v, added: now() });
    }
    (e.record.history ||= []).push({
      at: now(),
      note: clear ? "Test values cleared" : `Test values recorded: ${(values || []).map((v) => v.label).join(", ")}`,
    });
    await saveRecord(e.recordFile, e.record);
    return { test_values: e.record.testValues };
  }
);

// ---------- files and images ----------

async function allowedSourceRoots() {
  const roots = [tmpdir(), envValue("TMPDIR"), claudeDir(), path.join(homedir(), "Downloads"), await findWorkspace()];
  if (process.platform !== "win32") roots.push("/tmp", "/private/tmp", "/var/folders", "/private/var/folders");
  const out = [];
  for (const r of roots.filter(Boolean)) out.push(await realpath(r).catch(() => path.resolve(r)));
  return out;
}

async function checkSource(p, exts) {
  const real = await realpath(path.resolve(p)).catch(() => {
    throw new Error(`File not found: ${p}`);
  });
  const roots = await allowedSourceRoots();
  if (!roots.some((r) => isInside(r, real))) {
    throw new Error(`Files can only be taken from temporary folders, Claude's saved tool results, Downloads or the workspace: ${real}`);
  }
  if (exts && !exts.includes(path.extname(real).toLowerCase())) throw new Error(`Unsupported file type: ${path.extname(real) || "none"}`);
  return real;
}

const COPYABLE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".json", ".html", ".txt", ".pdf"];

tool(
  "import_file",
  "Copy a file into an email's folder, e.g. a Figma or Litmus screenshot saved in a temp folder → design/figma.png, images/hero.png or qa/v2/outlook2021-top.jpg. Use this instead of shell cp.",
  {
    client: clientArg,
    email: emailArg,
    source_path: z.string().describe("Absolute path of the saved file"),
    dest: z.string().describe('Path inside the email folder, e.g. "images/hero.png"'),
  },
  async ({ client, email, source_path, dest }) => {
    const e = await requireEmail(client, email);
    const src = await checkSource(source_path, COPYABLE);
    const target = await within(e.emailDir, dest, { mustExist: false });
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(src, target);
    const info = /\.(png|jpe?g|gif)$/i.test(target) ? await imageInfo(target) : { bytes: (await stat(target)).size };
    return { saved: path.relative(e.dir, target).split(path.sep).join("/"), ...info };
  }
);

tool(
  "image_info",
  "Size, format and dimensions of one image, or of every image in the email's images/ folder. Flags transparent PNGs with dark pixels (they vanish in dark mode), photos with many near-black pixels (Outlook 2021 specks lead), oversized files and unsupported formats.",
  { client: clientArg, email: emailArg, file: z.string().optional().describe('e.g. "images/logo.png"; leave out for all of images/') },
  async ({ client, email, file }) => {
    const e = await requireEmail(client, email);
    if (file) return imageInfo(await within(e.emailDir, file));
    const dir = path.join(e.emailDir, "images");
    const out = [];
    for (const f of (await readdir(dir).catch(() => [])).filter((n) => /\.(png|jpe?g|gif|webp|svg)$/i.test(n)).sort()) {
      out.push(await imageInfo(path.join(dir, f)));
    }
    return { images: out, total_kb: +out.reduce((a, i) => a + i.kb, 0).toFixed(1) };
  }
);

tool(
  "convert_image",
  "Convert a PNG in the email folder to JPG (smaller for photos), flattening any transparency onto a background color.",
  {
    client: clientArg,
    email: emailArg,
    file: z.string().describe('e.g. "images/hero.png"'),
    quality: z.number().int().min(40).max(95).default(82),
    background: z.string().default("#ffffff").describe("Hex color behind transparent areas"),
  },
  async ({ client, email, file, quality, background }) => {
    const e = await requireEmail(client, email);
    const src = await within(e.emailDir, file);
    const dest = src.replace(/\.png$/i, ".jpg");
    if (dest === src) throw new Error("Only .png files can be converted.");
    const r = await pngToJpg(src, dest, { quality, background });
    return { from: file, to: path.relative(e.emailDir, dest).split(path.sep).join("/"), ...r };
  }
);

tool(
  "lift_blacks",
  "Save a copy of a photo with its darkest pixels raised to about luma `floor` (0-255). Mid-tones and highlights stay the same. This tests the lead for white specks on near-black photo areas in Outlook 2021 (not confirmed). Use the copy as a variant next to the original, not as a silent swap.",
  {
    client: clientArg,
    email: emailArg,
    file: z.string().describe('e.g. "images/hero-bottom.jpg"'),
    dest: z.string().optional().describe('Default: the same name with "-lifted" added, e.g. "images/hero-bottom-lifted.jpg"'),
    floor: z.number().int().min(8).max(40).default(18),
    quality: z.number().int().min(60).max(95).default(90),
  },
  async ({ client, email, file, dest, floor, quality }) => {
    const e = await requireEmail(client, email);
    const src = await within(e.emailDir, file);
    if (!/\.(jpe?g|png)$/i.test(src)) throw new Error("Only JPG and PNG files can be lifted.");
    const target = await within(e.emailDir, dest || file.replace(/(\.[a-z]+)$/i, "-lifted$1"), { mustExist: false });
    if (target === src) throw new Error("dest must differ from file. Keep the original for the control variant.");
    await mkdir(path.dirname(target), { recursive: true });
    const r = await liftBlacks(src, target, { floor, quality });
    return { from: file, saved: path.relative(e.emailDir, target).split(path.sep).join("/"), floor, ...r };
  }
);

tool(
  "crop_image",
  "Cut a region out of a capture in the email folder, e.g. a blend-mode layer out of its parent frame's screenshot so the blend and background are kept. Coordinates are design pixels relative to the capture's top-left; design_width is the capture's width in design pixels (scale is worked out from it). Output format follows dest (.png or .jpg).",
  {
    client: clientArg,
    email: emailArg,
    source: z.string().describe('e.g. "design/hero-band.png"'),
    dest: z.string().describe('e.g. "images/hero.jpg"'),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    design_width: z.number().positive().describe("Width of the captured node in design pixels"),
    quality: z.number().int().min(40).max(95).default(85),
  },
  async ({ client, email, source, dest, x, y, w, h, design_width, quality }) => {
    const e = await requireEmail(client, email);
    const src = await within(e.emailDir, source);
    const target = await within(e.emailDir, dest, { mustExist: false });
    await mkdir(path.dirname(target), { recursive: true });
    const r = await cropImage(src, target, { x, y, w, h, designWidth: design_width, quality });
    return { saved: path.relative(e.emailDir, target).split(path.sep).join("/"), ...r };
  }
);

// ---------- compile, pre-check, preview ----------

tool(
  "compile_email",
  "Compile the email's email.mjml to build/email.html with MJML 5. Returns size and any MJML errors.",
  { client: clientArg, email: emailArg },
  async ({ client, email }) => {
    const e = await requireEmail(client, email);
    const src = await within(e.emailDir, "email.mjml").catch(() => {
      throw new Error(`No email.mjml yet in ${e.emailDir}.`);
    });
    const out = path.join(e.emailDir, "build", "email.html");
    const source = await readFile(src, "utf8");
    const result = await mjml2html(source, { validationLevel: "soft", filePath: src });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, result.html);
    const bytes = Buffer.byteLength(result.html);
    const errors = (result.errors || []).slice(0, 25).map((x) => x.formattedMessage || x.message);
    e.record.lastBuild = { at: now(), bytes, mjml_errors: errors.length };
    await saveRecord(e.recordFile, e.record);
    const variants = summarizeVariants(source);
    return {
      output: path.relative(e.dir, out).split(path.sep).join("/"),
      kb: +(bytes / 1024).toFixed(1),
      mjml_errors: errors,
      ...((variants.count > 0 || variants.problems.length > 0) && {
        test_variants: variants.groups.map((g) => `${g.group}: ${g.ids.join(", ")}`),
        ...(variants.problems.length && { variant_problems: variants.problems }),
        variants_note: "This build holds test variants. Fine for a Litmus round; resolve_variants removes them before the client gets the email.",
      }),
    };
  }
);

async function urlStatus(url) {
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch (err) {
    return `ERR ${err.cause?.code || err.name || err.message}`;
  }
}

tool(
  "precheck_email",
  "Pre-check build/email.html before Klaviyo or Litmus: size, alt text, hosted https images, links and images responding, placeholder links, WCAG AA text contrast, text that loses contrast in Gmail App Android or Outlook Windows dark mode (approximation), dark-mode risk in transparent PNGs, near-black photo areas, and test values still in place. `failed` blocks a test; `warnings` don't.",
  { client: clientArg, email: emailArg, check_urls: z.boolean().default(true) },
  async ({ client, email, check_urls }) => {
    const e = await requireEmail(client, email);
    const file = path.join(e.emailDir, "build", "email.html");
    const html = await readFile(file, "utf8").catch(() => {
      throw new Error("No build/email.html yet. Run compile_email first.");
    });
    const checks = [];
    const warnings = [];
    const add = (pass, check, detail) => checks.push({ pass, check, ...(detail ? { detail } : {}) });
    const testValues = e.record.testValues || [];

    const variantSrc = await readFile(path.join(e.emailDir, "email.mjml"), "utf8").catch(() => "");
    const variants = summarizeVariants(variantSrc);
    const bytes = Buffer.byteLength(html);
    if (variants.count > 0 && bytes >= 90 * 1024) {
      // Variants repeat sections, so the size only counts once they are resolved.
      warnings.push(`HTML is ${(bytes / 1024).toFixed(1)} KB with ${variants.count} test variants in it. Check the size again after resolve_variants (Gmail clips at ~102 KB).`);
    } else {
      add(bytes < 90 * 1024, "HTML under 90 KB (Gmail clips at ~102 KB)", `${(bytes / 1024).toFixed(1)} KB`);
    }
    if (variants.count > 0) {
      warnings.push(`Test variants in the email: ${variants.groups.map((g) => `${g.group} (${g.ids.join(", ")})`).join("; ")}. Fine for a Litmus round. resolve_variants must remove them before handoff.`);
    }
    for (const p of variants.problems) add(false, "Test variant blocks are complete", p);

    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t));
    add(noAlt.length === 0, "Every image has an alt attribute", `${imgs.length} images, ${noAlt.length} missing`);

    // Background images too: MJML's background attribute, CSS url() and Outlook VML fills.
    const isImageRef = (u) => !/^(#|data:)/i.test(u) && (/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(u) || /\/images\//i.test(u));
    const bgUrls = [
      ...[...html.matchAll(/\bbackground\s*=\s*"([^"]+)"/gi)].map((m) => m[1]),
      ...[...html.matchAll(/url\(\s*(?:&quot;|['"])?([^'")&]+)(?:&quot;|['"])?\s*\)/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<v:(?:fill|image)\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)].map((m) => m[1]),
    ]
      .map((u) => u.trim())
      .filter(isImageRef);
    const srcs = [...new Set([...imgs.map((t) => (t.match(/\bsrc\s*=\s*"([^"]+)"/i) || [])[1]).filter(Boolean), ...bgUrls])];
    const notHttps = srcs.filter((s) => !s.startsWith("https://"));
    add(notHttps.length === 0, "Every image URL is absolute https (hosted)", notHttps.length ? `local or http: ${notHttps.join(", ")}` : `${srcs.length} unique`);

    // Litmus flags preview text under 90 characters; inboxes cut it after about 130.
    const mjmlSrc = await readFile(path.join(e.emailDir, "email.mjml"), "utf8").catch(() => "");
    const preview = (mjmlSrc.match(/<mj-preview>([\s\S]*?)<\/mj-preview>/i) || [])[1];
    if (preview !== undefined) {
      const n = preview.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
      add(n >= 90 && n <= 130, "Preview text is 90–130 characters (Litmus flags shorter)", `${n} characters`);
    } else {
      add(false, "Email has an mj-preview (90–130 characters)", "No mj-preview in email.mjml");
    }

    const placeholder = /\bexample\.(com|org|net)\b/i.test(html);
    const placeholderIsTestValue = testValues.some((t) => /\bexample\.(com|org|net)\b/i.test(t.value));
    if (placeholder && placeholderIsTestValue) warnings.push("example.com links are recorded test values; replace them before a real send.");
    else add(!placeholder, "No example.com placeholder links", placeholder ? "Record them with set_test_values if they're deliberate test links" : undefined);

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

    const contrast = checkContrast(html);
    add(
      contrast.issues.length === 0,
      "Text contrast meets WCAG AA (4.5:1, or 3:1 for large text)",
      contrast.issues.length
        ? contrast.issues.map((i) => `${i.color} on ${i.background} = ${i.ratio}:1 (needs ${i.required}:1), e.g. "${i.examples[0]}"`).join("; ")
        : `${contrast.text_nodes_checked} text runs checked`
    );

    // Dark-mode and near-black risks in the images the email uses: local links, or the hosted links host_images recorded.
    const hosted = e.record.klaviyo?.images || {};
    // Text that loses contrast only in a client's forced dark mode (Gmail App Android, classic Outlook on Windows).
    // The colours come from the dark-sim approximation, so these are warnings: Litmus is the proof.
    const lightTexts = new Set(contrast.issues.flatMap((i) => i.examples));
    for (const mode of DARK_MODES.filter((m) => m.id !== "apple")) {
      let dark;
      try {
        dark = checkContrast(simulateDark(html, mode.id));
      } catch {
        continue;
      }
      const fresh = dark.issues.filter((i) => !i.examples.every((x) => lightTexts.has(x)));
      if (fresh.length) {
        warnings.push(
          `Dark mode, ${mode.label} (approximation): ${fresh
            .slice(0, 4)
            .map((i) => `${i.color} on ${i.background} = ${i.ratio}:1, e.g. "${i.examples[0]}"`)
            .join("; ")}. Look at this frame in preview_email and check the client in Litmus.`
        );
      }
    }

    for (const f of (await readdir(path.join(e.emailDir, "images")).catch(() => [])).filter((n) => /\.(png|jpe?g)$/i.test(n))) {
      const url = hosted[`images/${f}`];
      if (!html.includes(`images/${f}`) && !(url && html.includes(url))) continue;
      const info = await imageInfo(path.join(e.emailDir, "images", f)).catch(() => null);
      for (const w of info?.warnings || []) if (/dark/i.test(w)) warnings.push(`images/${f}: ${w}`);
    }

    const present = testValues.filter((t) => html.includes(t.value));
    if (present.length) warnings.push(`Test values still in the email: ${present.map((t) => t.label).join(", ")}. Replace them before a real send.`);

    const tags = [...new Set([...html.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)].map((m) => m[0]))];
    if (!tags.some((t) => /unsubscribe/.test(t))) warnings.push("No Klaviyo unsubscribe tag found ({% unsubscribe_link %}).");
    const passed = checks.every((c) => c.pass);
    e.record.lastPrecheck = {
      at: now(),
      passed,
      failed: checks.filter((c) => !c.pass).map((c) => `${c.check}: ${c.detail || ""}`),
      warnings,
    };
    await saveRecord(e.recordFile, e.record);
    return {
      file: path.relative(e.dir, file).split(path.sep).join("/"),
      passed,
      failed: checks.filter((c) => !c.pass),
      warnings,
      checks,
      klaviyo_tags: tags,
      klaviyo_tag_links: tagLinks,
      note: "Klaviyo tags are filled in only when Klaviyo renders or sends the email.",
    };
  }
);

tool(
  "preview_email",
  "Serve the compiled email on this computer (127.0.0.1) and return preview URLs: a compare page (desktop 600px, mobile 375px, then one dark-mode frame each for Apple Mail, Gmail App Android and classic Outlook on Windows) plus the raw email and each dark view. The dark frames are approximations of each client's colour change, not renders. Screenshot them with the browser before a Litmus send, or open them for the user.",
  { client: clientArg, email: emailArg, open: z.boolean().default(false).describe("Also open the compare page in the default browser") },
  async ({ client, email, open }) => {
    const e = await requireEmail(client, email);
    const html = path.join(e.emailDir, "build", "email.html");
    if (!existsSync(html)) throw new Error("No build/email.html yet. Run compile_email first.");
    const clientsRoot = path.join(e.ws, "clients");
    const { port } = await ensurePreviewServer(clientsRoot);
    const urls = previewUrls(port, await realpath(clientsRoot), await realpath(html), `${e.config.name} / ${e.email}`);
    if (open) openInBrowser(urls.compare);
    return {
      ...urls,
      note: "The server runs while this Claude session is open. Local images (../images/…) show here; Klaviyo-hosted images need internet.",
    };
  }
);

// ---------- client handoff (no client API key) ----------
//
// The email is tested with images hosted in the agency's Klaviyo test account. The same image files are
// uploaded to the client's Klaviyo (by the handler, or by Claude in the handler's logged-in browser) and the
// new links come back here. set_client_klaviyo_account records which account is the client's;
// pack_images_for_client prepares the files; apply_client_image_links checks the links and swaps them in.
// clients/<client>/.cache/client-images.json remembers images already in each client account, so they're reused.
// Per email: emails/<email>/handoff/v<N>/ holds images/ to upload, UPLOAD-STEPS.txt, then <name>-final.html.

const MAX_DOWNLOAD = 15 * 1024 * 1024;

function clientCacheFile(clientDir) {
  return path.join(clientDir, ".cache", "client-images.json");
}
const loadClientCache = (clientDir) => readJson(clientCacheFile(clientDir), {}).catch(() => ({}));
const saveClientCache = (clientDir, cache) => writeJson(clientCacheFile(clientDir), cache);

// Account IDs of the test-account images recorded in any email of any client. One test account serves
// every client, so a client's account must never be one of these.
async function testAccountIds(ws) {
  const ids = new Set();
  for (const slug of await listClientSlugs(ws)) {
    const clientDir = path.join(ws, "clients", slug);
    for (const rel of await findEmails(clientDir)) {
      try {
        const r = await readJson(path.join(clientDir, "emails", ...rel.split("/"), "email.json"));
        for (const url of Object.values(r.klaviyo?.images || {})) {
          const id = accountIdOf(url);
          if (id) ids.add(id);
        }
      } catch {}
    }
  }
  return ids;
}

tool(
  "set_client_klaviyo_account",
  "Record which Klaviyo account is this client's: its account (company) name and its public API key / site ID, as read from the client's Klaviyo (Settings → API keys, \"Public API Key / site ID\" table). Afterwards every client image link must come from this account. Refuses the test account's key.",
  {
    client: clientArg,
    account_name: z.string().min(1).describe("Company Name shown next to the public key"),
    public_key: z
      .string()
      .regex(/^[A-Za-z0-9]{4,12}$/)
      .describe("The public API key / site ID, e.g. AbC123. It's the <id> in https://cdn.klaviyomail.com/company/<id>/..."),
  },
  async ({ client, account_name, public_key }) => {
    const c = await requireClient(client);
    if ((await testAccountIds(c.ws)).has(public_key)) {
      throw new Error(`${public_key} is the Klaviyo test account used for testing, not a client account. Open the client's own account and read its key there.`);
    }
    const previous = c.config.clientKlaviyo || null;
    c.config.clientKlaviyo = { accountName: account_name, publicKey: public_key, savedAt: now() };
    c.config.updated = now();
    await writeClient(c.dir, c.config);
    return {
      client,
      saved: c.config.clientKlaviyo,
      ...(previous && previous.publicKey !== public_key && { replaced: previous, warning: "This client pointed at a different Klaviyo account before." }),
    };
  }
);

async function downloadHttps(url) {
  if (!/^https:\/\//i.test(url)) throw new Error("not an https link");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_DOWNLOAD) throw new Error("larger than 15 MB");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new Error("larger than 15 MB");
  return bytes;
}

const imgShape = (i) => `${i.format || "unknown type"} ${i.width && i.height ? `${i.width}x${i.height}` : "unknown size"}`;
// Path relative to a base folder with forward slashes, so records read the same on macOS and Windows.
const relTo = (base, p) => path.relative(base, p).split(path.sep).join("/");

tool(
  "pack_images_for_client",
  "After an email passed its Litmus test: copy the images the tested HTML uses into emails/<email>/handoff/v<version>/images/ for upload to the client's Klaviyo, with an UPLOAD-STEPS.txt for the handler. Images already uploaded to this client's account (remembered from earlier handoffs) are reused instead of packed again. Records which test-account link each image replaces. Refuses if this version has no recorded test or the email was rebuilt after it. Returns absolute paths for browser uploads.",
  {
    client: clientArg,
    email: emailArg,
    reupload_all: z
      .boolean()
      .default(false)
      .describe("Pack every image, even ones remembered as already in the client's account (use when a remembered link stopped working)"),
  },
  async ({ client, email, reupload_all }) => {
    const e = await requireEmail(client, email);
    const { record } = e;
    let html;
    try {
      html = await readFile(await within(e.emailDir, path.join("build", "email.html")), "utf8");
    } catch {
      throw new Error(`"${e.email}" has no build/email.html. Compile it first (build-email skill).`);
    }

    const leftover = summarizeVariants(await readFile(path.join(e.emailDir, "email.mjml"), "utf8").catch(() => ""));
    if (leftover.count > 0) {
      throw new Error(`email.mjml still has test variants (${leftover.groups.map((g) => g.group).join(", ")}). Keep one variant per group with resolve_variants, compile, and test the result before the handoff.`);
    }
    const tests = (record.tests || []).filter((t) => t.version === record.version);
    const lastTest = tests[tests.length - 1];
    if (!record.version || !lastTest) {
      throw new Error(`Version ${record.version} of "${e.email}" has no recorded Litmus test. Test it first (test-email skill), then pack.`);
    }
    if (record.lastBuild?.at && new Date(record.lastBuild.at) > new Date(lastTest.at)) {
      throw new Error(`"${e.email}" was rebuilt after its last Litmus test (${lastTest.at}). Re-test it, so the client gets exactly what was tested.`);
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

    const ck = e.config.clientKlaviyo || null;
    const remembered = ck && !reupload_all ? (await loadClientCache(e.dir))[ck.publicKey] || {} : {};

    const versionDir = path.join("handoff", `v${record.version}`);
    const outDir = await within(e.emailDir, path.join(versionDir, "images"), { mustExist: false });
    await rm(outDir, { recursive: true, force: true }); // a re-pack starts from an empty folder
    await mkdir(outDir, { recursive: true });
    const stem = e.email.replace(/\//g, "-"); // "black-friday/teaser" -> "black-friday-teaser"
    const packed = [];
    const seen = new Set();
    for (const [file, testUrl] of used) {
      if (seen.has(testUrl)) continue; // the same hosted image listed under two names
      seen.add(testUrl);
      if (path.basename(file) !== file) throw new Error(`email.json klaviyo.images has a path instead of a file name: ${file}`);
      const bytes = await readFile(await within(e.emailDir, path.join("images", file)));
      const info = fileFingerprint(bytes);
      const packedAs = file.startsWith(`${stem}-`) ? file : `${stem}-${file}`;
      // Is the local file the one that was tested? Compare it with the test-account copy.
      let testCopy;
      try {
        const hosted = fileFingerprint(await downloadHttps(testUrl));
        testCopy =
          hosted.sha256 === info.sha256
            ? "identical"
            : hosted.format === info.format && hosted.width === info.width && hosted.height === info.height
              ? "same-size"
              : "different";
      } catch (err) {
        testCopy = `unreachable (${err.message})`;
      }
      if (testCopy === "different") {
        throw new Error(`images/${file} (${imgShape(info)}) isn't the image that was tested at ${testUrl}. Re-host it and re-test before packing.`);
      }
      const reuseUrl = remembered[info.sha256]?.url || null;
      if (!reuseUrl) await writeFile(path.join(outDir, packedAs), bytes);
      packed.push({ file, packedAs, testUrl, format: info.format, width: info.width, height: info.height, bytes: info.bytes, sha256: info.sha256, testCopy, reuseUrl });
    }
    const toUpload = packed.filter((p) => !p.reuseUrl);
    const reused = packed.filter((p) => p.reuseUrl);

    const where = ck ? `the CLIENT's Klaviyo account "${ck.accountName}" (public key ${ck.publicKey})` : "the CLIENT's Klaviyo account";
    const stepsFile = await within(e.emailDir, path.join(versionDir, "UPLOAD-STEPS.txt"), { mustExist: false });
    await writeFile(
      stepsFile,
      [
        `${e.config.name} / ${record.name || e.email}, version ${record.version}: images for the client's Klaviyo account`,
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
      folder: relTo(e.dir, path.dirname(outDir)),
      testedHtmlSha256: sha256(html),
      clientAccount: ck?.publicKey || null,
      images: packed,
      clientImages: null,
      finalHtml: null,
    };
    (record.history ||= []).push({
      at: now(),
      note: `Packed ${toUpload.length} images for the client's Klaviyo${reused.length ? `, ${reused.length} reused` : ""} (v${record.version})`,
    });
    await saveRecord(e.recordFile, record);

    return {
      client_account: ck ? `${ck.accountName} (${ck.publicKey})` : "not recorded yet; set_client_klaviyo_account makes every link get checked against it",
      images_folder: relTo(e.dir, outDir),
      images_folder_absolute: outDir,
      steps_for_handler: relTo(e.dir, stepsFile),
      steps_for_handler_absolute: stepsFile,
      to_upload: toUpload.map((p) => ({
        file: p.packedAs,
        absolute_path: path.join(outDir, p.packedAs),
        image: imgShape(p),
        kb: +(p.bytes / 1024).toFixed(1),
        matches_tested_copy: p.testCopy,
      })),
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
  "Swap the client's image links into the tested HTML. Pass every image link from the client's Klaviyo (pasted by the handler or read from the image library), in any order: each is downloaded and matched to a packed image by its content. Images reused from earlier uploads are added automatically. Writes emails/<email>/handoff/v<version>/<name>-final.html only when every image matched, every link is from the client's account, no test-account link is left, and nothing but the image links changed.",
  {
    client: clientArg,
    email: emailArg,
    links: z.array(z.string()).max(100).default([]).describe("Every image link from the client's Klaviyo for this email"),
    mapping: z
      .record(z.string(), z.string())
      .optional()
      .describe("Only when automatic matching couldn't decide: {\"<packed file name>\": \"<link>\"}, as the handler says"),
  },
  async ({ client, email, links, mapping }) => {
    const e = await requireEmail(client, email);
    const { record } = e;
    const h = record.handoff;
    if (!h?.images?.length) throw new Error(`No packed images for "${e.email}". Run pack_images_for_client first.`);
    if (h.version !== record.version) {
      throw new Error(`The packed images are for version ${h.version}, but the email is now version ${record.version}. Test and pack again.`);
    }
    let html;
    try {
      html = await readFile(await within(e.emailDir, path.join("build", "email.html")), "utf8");
    } catch {
      throw new Error(`"${e.email}" has no build/email.html any more. Compile, re-test and pack again.`);
    }
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
      throw new Error(`These links are from the Klaviyo test account, not the client's. Take them from the client's account: ${fromTest.join(", ")}`);
    }
    const ck = e.config.clientKlaviyo || null;
    if (ck) {
      const foreign = urls.filter((u) => accountIdOf(u) !== ck.publicKey);
      if (foreign.length) {
        throw new Error(
          `These links aren't from ${ck.accountName}'s Klaviyo account (public key ${ck.publicKey}). Check the right account is open, then take the links from there: ${foreign.join(", ")}`
        );
      }
    }

    const fetched = [];
    const failedDownloads = [];
    for (const url of urls) {
      try {
        fetched.push({ url, ...fileFingerprint(await downloadHttps(url)) });
      } catch (err) {
        failedDownloads.push(`${url}: ${err.message}`);
      }
    }
    const m = matchLinks(h.images, fetched, explicit);
    const clientAccounts = [...new Set(m.matches.map((x) => accountIdOf(x.clientUrl)).filter(Boolean))];
    if (clientAccounts.length > 1) m.problems.push(`The links come from ${clientAccounts.length} different Klaviyo accounts (${clientAccounts.join(", ")}). They should all be from the client's one account.`);

    // A remembered link that no longer works or no longer matches is forgotten, so the next pack includes that image.
    const stale = Object.entries(remembered).filter(([packedAs, url]) => !m.matches.some((x) => x.packedAs === packedAs && x.clientUrl === url));
    const cache = await loadClientCache(e.dir);
    if (stale.length) {
      for (const [packedAs] of stale) {
        const img = h.images.find((i) => i.packedAs === packedAs);
        for (const acct of Object.keys(cache)) delete cache[acct]?.[img.sha256];
      }
      await saveClientCache(e.dir, cache);
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

    const finalName = `${path.basename(e.email)}-final.html`;
    const finalFile = await within(e.emailDir, path.join("handoff", `v${h.version}`, finalName), { mustExist: false });
    await mkdir(path.dirname(finalFile), { recursive: true });
    await writeFile(finalFile, swap.html);

    // Remember these images for this client, so later emails reuse them instead of uploading again.
    for (const x of m.matches) {
      const acct = accountIdOf(x.clientUrl);
      const img = h.images.find((i) => i.packedAs === x.packedAs);
      if (!acct || !img) continue;
      (cache[acct] ||= {})[img.sha256] = { url: x.clientUrl, name: x.packedAs, at: now() };
    }
    await saveClientCache(e.dir, cache);

    record.handoff = {
      ...h,
      clientImages: Object.fromEntries(m.matches.map((x) => [x.packedAs, x.clientUrl])),
      clientAccount: clientAccounts[0] || null,
      finalHtml: relTo(e.dir, finalFile),
      finalHtmlSha256: sha256(swap.html),
      finalizedAt: now(),
    };
    (record.history ||= []).push({ at: now(), note: `Final HTML with the client's image links written (v${h.version})` });
    await saveRecord(e.recordFile, record);

    const recompressed = m.matches.filter((x) => x.how === "same-size");
    return {
      final_html: relTo(e.dir, finalFile),
      final_html_absolute: finalFile,
      client_account: ck ? `${ck.accountName} (${ck.publicKey})` : clientAccounts[0] || null,
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

tool(
  "summarize_design",
  "Turn a saved Figma result into a compact outline: from the EmailQA layout script (skills/build-email/figma-outline.js via figma_execute) you get positions relative to the frame, blend modes, fonts and text; from figma_get_component_for_development_deep you get auto-layout, fills and fonts. Warnings (outlined text, blend modes) come first.",
  {
    file_path: z.string().describe("Absolute path of the saved result (JSON)"),
    max_lines: z.number().int().min(50).max(2000).default(500),
  },
  async ({ file_path, max_lines }) => {
    const file = await checkSource(file_path);
    let data;
    try {
      const raw = await readFile(file, "utf8");
      data = JSON.parse(raw);
      // Tool results are sometimes saved as [{type:"text", text:"<json>"}].
      if (Array.isArray(data) && data[0]?.type === "text") data = JSON.parse(data[0].text);
      if (data?.result && typeof data.result === "string") data.result = JSON.parse(data.result);
    } catch {
      throw new Error("That file isn't JSON from a Figma result.");
    }
    return summarize(data?.result?.emailqaOutline ? data.result : data, max_lines);
  }
);

await server.connect(new StdioServerTransport());
