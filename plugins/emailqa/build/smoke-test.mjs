// Smoke test for the bundled EmailQA servers: starts dist/*.mjs over stdio exactly as Claude Code does
// (no node_modules next to them) and drives the main tools in a throwaway workspace.
// Run: npm test (from this folder). Add --figma-install to also install and start the real Figma server.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const t = mkdtempSync(path.join(tmpdir(), "emailqa-smoke-"));
const dirs = Object.fromEntries(["data", "claude", "session", "src"].map((d) => [d, path.join(t, d)]));
Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));
// Claude is opened in this folder, which already holds a file: it becomes the workspace and the file stays.
const ws = path.join(t, "Email Projects");
mkdirSync(ws, { recursive: true });
writeFileSync(path.join(ws, "notes.txt"), "kept");
const env = {
  ...process.env,
  CLAUDE_PLUGIN_ROOT: root,
  EMAILQA_DATA: dirs.data,
  CLAUDE_CONFIG_DIR: dirs.claude,
  CLAUDE_PROJECT_DIR: ws,
  LITMUS_TEST_ADDRESS: "qa@litmusemail.com",
  KLAVIYO_API_KEY: "${user_config.klaviyo_api_key}", // unset, as Claude passes it when empty
};

let failures = 0;
const check = (cond, label, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? `\n      ${String(extra).slice(0, 600)}` : ""}`);
  if (!cond) failures++;
};

function startServer(file, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(root, "dist", file)], { env: { ...env, ...extraEnv }, cwd: dirs.session, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let stderr = "";
  const waiting = new Map();
  let id = 0;
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        waiting.get(msg.id)?.(msg);
      } catch {}
    }
  });
  child.stderr.on("data", (d) => (stderr += d));
  const request = (method, params, timeout = 120000) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}\n${stderr.slice(-800)}`)), timeout);
      waiting.set(myId, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  const api = {
    async init() {
      const r = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }, 30000);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      return r.result;
    },
    async tools() {
      return (await request("tools/list", {})).result.tools.map((x) => x.name);
    },
    async call(name, args = {}) {
      const r = await request("tools/call", { name, arguments: args });
      const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { isError: !!r.result?.isError || !!r.error, data, text };
    },
    stop() {
      child.stdin.end();
      setTimeout(() => child.kill(), 1500).unref();
    },
    get stderr() {
      return stderr;
    },
  };
  return api;
}

function writePng(file, w, h, pixel) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * w + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  writeFileSync(file, PNG.sync.write(png));
}

// ---------- email-build ----------
const b = startServer("email-build.mjs");
const info = await b.init();
check(info?.serverInfo?.name === "email-build", "email-build starts from the bundle");
const names = await b.tools();
for (const n of ["setup_status", "install_figma_server", "prepare_figma_bridge", "create_workspace", "new_client", "new_email", "compile_email", "precheck_email", "preview_email", "import_file", "crop_image", "summarize_design", "import_old_project", "set_client_klaviyo_account", "pack_images_for_client", "apply_client_image_links"]) {
  check(names.includes(n), `tool ${n} listed`);
}

for (const n of ["plan_fixes", "find_lessons", "record_lesson", "resolve_variants", "lift_blacks"]) check(names.includes(n), `tool ${n} listed`);

let r = await b.call("setup_status");
check(!r.isError && r.data.checks?.length >= 6, "setup_status runs", r.text);
check(r.data.checks?.find((c) => c.id === "figma-server")?.ok === false, "setup_status: Figma server not installed yet");
check(r.data.checks?.find((c) => c.id === "litmus-address")?.ok === true, "setup_status: Litmus address accepted");

r = await b.call("list_clients");
check(r.isError && /isn't an EmailQA workspace yet/.test(r.text), "tools ask for create_workspace in a new folder", r.text);
r = await b.call("create_workspace", {});
check(!r.isError && r.data.created && r.data.workspace === realpathSync(ws) && existsSync(path.join(ws, "workspace.json")), "create_workspace with no path uses the session folder", r.text);
check(r.data.kept_existing_files === 1 && existsSync(path.join(ws, "notes.txt")), "create_workspace keeps the files already in the folder", r.text);
check(existsSync(path.join(ws, "library", "mjml-starter.mjml")), "library seeded");
r = await b.call("create_workspace", { path: dirs.claude });
check(r.isError, "create_workspace refuses Claude's config folder");
{
  // A session opened in another folder must not write into the workspace recorded at setup...
  const other = startServer("email-build.mjs", { CLAUDE_PROJECT_DIR: dirs.session });
  await other.init();
  const x = await other.call("list_clients");
  check(x.isError && /isn't an EmailQA workspace yet/.test(x.text), "a session in another folder does not use the old workspace", x.text);
  other.stop();
  // ...but a session opened in the home folder (which can't be a workspace) falls back to it.
  const home = path.join(t, "home");
  mkdirSync(home, { recursive: true });
  const fromHome = startServer("email-build.mjs", { HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: home });
  await fromHome.init();
  const y = await fromHome.call("list_clients");
  check(!y.isError, "a session in the home folder falls back to the recorded workspace", y.text);
  fromHome.stop();
}

r = await b.call("new_client", { name: "Acme Outdoors", figma_file_urls: ["https://www.figma.com/design/2QGsznyC6myiv41zPJlSxu/Templates?node-id=1-2"], litmus_address: "qa+123@litmusemail.com" });
check(!r.isError && r.data.client === "acme-outdoors", "new_client", r.text);
r = await b.call("new_client", { name: "Bad", litmus_address: "someone@gmail.com" });
check(r.isError, "new_client refuses a non-Litmus folder address");

r = await b.call("new_email", { client: "acme-outdoors", name: "Spring Teaser", group: "Spring Campaign" });
check(!r.isError && r.data.email === "spring-campaign/spring-teaser", "new_email in a group subfolder", r.text);
const emailDir = path.join(ws, "clients", "acme-outdoors", "emails", "spring-campaign", "spring-teaser");
r = await b.call("new_email", { client: "acme-outdoors", name: "x", group: "../../escape" });
check(r.isError || !r.data.folder?.includes("escape") || r.data.email === "escape/x", "new_email can't escape the client folder", r.text);
r = await b.call("new_email", { client: "../acme", name: "x" });
check(r.isError, "invalid client name refused");

// images
writePng(path.join(dirs.src, "logo.png"), 120, 40, (x) => (x < 60 ? [20, 20, 20, 255] : [0, 0, 0, 0]));
writePng(path.join(dirs.src, "band.png"), 1200, 400, (x, y) => [235, 234, 222, 255]);
r = await b.call("import_file", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", source_path: path.join(dirs.src, "logo.png"), dest: "images/logo.png" });
check(!r.isError && r.data.width === 120, "import_file copies into images/", r.text);
check(r.data.warnings?.some((w) => /dark/i.test(w)), "dark-pixel transparent PNG flagged");
r = await b.call("import_file", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", source_path: "/etc/hosts", dest: "images/x.png" });
check(r.isError, "import_file refuses files outside allowed folders");
await b.call("import_file", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", source_path: path.join(dirs.src, "band.png"), dest: "design/band.png" });
r = await b.call("crop_image", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", source: "design/band.png", dest: "images/hero.jpg", x: 100, y: 50, w: 300, h: 100, design_width: 600 });
check(!r.isError && r.data.width === 600 && r.data.height === 200 && r.data.scale === 2, "crop_image uses 2x scale", r.text);
r = await b.call("convert_image", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", file: "design/band.png" });
check(!r.isError && r.data.to_bytes > 0, "convert_image PNG → JPG", r.text);

// A photo with a large near-black area (the Outlook 2021 specks lead), and lift_blacks.
const writeJpg = (file, w, h, px) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  writeFileSync(file, jpeg.encode({ data, width: w, height: h }, 90).data);
};
const darkPhoto = (x, y) => (x < 200 ? [2, 2, 3, 255] : [120 + (y % 40), 100, 80, 255]);
writeJpg(path.join(dirs.src, "photo.jpg"), 400, 300, darkPhoto);
writeJpg(path.join(dirs.src, "unused-dark.jpg"), 400, 300, darkPhoto);
const SP = { client: "acme-outdoors", email: "spring-campaign/spring-teaser" };
r = await b.call("import_file", { ...SP, source_path: path.join(dirs.src, "photo.jpg"), dest: "images/photo.jpg" });
check(!r.isError && r.data.near_black_share > 0.3 && r.data.warnings?.some((w) => /Near-black/.test(w)), "near-black JPEG photo flagged", r.text);
await b.call("import_file", { ...SP, source_path: path.join(dirs.src, "unused-dark.jpg"), dest: "images/unused-dark.jpg" });
r = await b.call("lift_blacks", { ...SP, file: "images/photo.jpg" });
check(!r.isError && r.data.saved === "images/photo-lifted.jpg" && r.data.before.near_black_share > 0.3 && r.data.after.near_black_share < 0.02 && r.data.after.min_luma >= 10, "lift_blacks raises the darkest pixels", r.text);
r = await b.call("image_info", { ...SP, file: "images/photo-lifted.jpg" });
check(!r.isError && !r.data.warnings.some((w) => /Near-black/.test(w)), "lifted copy is not flagged", r.text);
r = await b.call("lift_blacks", { ...SP, file: "images/photo.jpg", dest: "images/photo.jpg" });
check(r.isError, "lift_blacks keeps the original");

// MJML with a low-contrast footer, a local image, a test link and a deliberate test value
writeFileSync(
  path.join(emailDir, "email.mjml"),
  `<mjml lang="en"><mj-head><mj-title>Spring</mj-title><mj-preview>Spring teaser preview text for testing the build</mj-preview></mj-head>
<mj-body width="600px" background-color="#f6f6f3"><mj-section background-color="#ffffff"><mj-column>
<mj-image src="../images/logo.png" alt="Acme" width="120px" />
<mj-image src="../images/photo.jpg" alt="Photo" />
<mj-text font-size="16px" color="#222222">Hello {{ first_name|default:"there" }}</mj-text>
<mj-button href="https://example.com/shop" background-color="#c8102e" color="#ffffff">Shop now</mj-button>
</mj-column></mj-section>
<mj-section background-color="#f9ca0a"><mj-column><mj-text font-size="16px" color="#01501e">Band text on yellow</mj-text></mj-column></mj-section>
<mj-section background-url="../images/hero.jpg" background-size="cover" background-color="#ffffff"><mj-column><mj-text font-size="16px" color="#111111">Text over a photo</mj-text></mj-column></mj-section>
<mj-section background-color="#f6f6f3"><mj-column><mj-text font-size="12px" color="#9a9a9a">100 Sample Street · <a href="{% unsubscribe_link %}" style="color:#9a9a9a">Unsubscribe</a></mj-text></mj-column></mj-section>
</mj-body></mjml>`
);
r = await b.call("compile_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser" });
check(!r.isError && r.data.mjml_errors.length === 0, "compile_email", r.text);
r = await b.call("precheck_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", check_urls: false });
check(!r.isError && r.data.passed === false, "precheck fails as expected", r.text);
const failedText = JSON.stringify(r.data.failed);
check(/contrast/i.test(failedText) && /#9a9a9a/i.test(failedText), "precheck catches footer contrast");
check(/absolute https/i.test(failedText), "precheck catches local images");
check(/hero\.jpg/.test(failedText), "precheck catches a local background image", failedText);
check(/Preview text is 90/.test(failedText), "precheck catches preview text under 90 characters", failedText);
check(/example\.com/i.test(failedText), "precheck catches example.com before it's recorded");
check(r.data.warnings.some((w) => /images\/logo\.png/.test(w)), "precheck warns about dark logo PNG");
check(r.data.warnings.some((w) => /images\/photo\.jpg: Near-black/.test(w)), "precheck warns about a near-black photo the email uses", JSON.stringify(r.data.warnings));
check(!r.data.warnings.some((w) => /unused-dark\.jpg/.test(w)), "precheck skips images the email does not use");
check(r.data.warnings.some((w) => /^Dark mode, Gmail App Android/.test(w) && /Band text on yellow/.test(w)), "precheck warns about dark text on a mid-tone band in Gmail Android dark", JSON.stringify(r.data.warnings));
check(!/Band text on yellow/.test(failedText), "the band passes light-mode contrast, so only the dark warning names it");

r = await b.call("set_test_values", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", values: [{ label: "Shop link", value: "https://example.com/shop" }, { label: "Footer address", value: "100 Sample Street" }] });
check(!r.isError && r.data.test_values.length === 2, "set_test_values", r.text);
r = await b.call("update_email_record", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", note: "smoke" });
check(!r.isError && r.data.saved === true && !("history" in r.data), "update_email_record returns a short acknowledgment", r.text);
r = await b.call("precheck_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", check_urls: false });
check(!/example\.com/i.test(JSON.stringify(r.data.failed)), "recorded test link no longer fails");
check(r.data.warnings.some((w) => /Test values still in the email/.test(w)), "test values warned while present");

r = await b.call("preview_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser" });
check(!r.isError && r.data.compare?.startsWith("http://127.0.0.1:"), "preview_email returns URLs", r.text);
if (!r.isError) {
  const page = await fetch(r.data.compare).then((x) => x.text());
  check(page.includes("Mobile 375px") && ["apple", "gmail-android", "outlook-windows"].every((m) => page.includes(`?dark=${m}`)), "compare page has 600/375 and one frame per client dark mode", page.slice(0, 400));
  check(r.data.dark_gmail_android && r.data.dark_outlook_windows && r.data.dark_apple, "preview_email returns a URL per dark mode", r.text);
  const light = await fetch(r.data.desktop).then((x) => x.text());
  const gmail = await fetch(r.data.dark_gmail_android).then((x) => x.text());
  const outlook = await fetch(r.data.dark_outlook_windows).then((x) => x.text());
  check(gmail !== light && outlook !== light && gmail !== outlook, "each client dark view changes the colours its own way");
  check(gmail.includes("{{ first_name") && gmail.includes("{% unsubscribe_link %}"), "dark views keep Klaviyo tags");
  check(/#ffffff/i.test(light) && (await fetch(r.data.desktop + "?dark=nope")).status === 400, "unknown dark mode refused");
  const img = await fetch(r.data.desktop.replace("build/email.html", "images/logo.png"));
  check(img.status === 200, "preview serves local images");
  const escape = await fetch(r.data.desktop.replace(/\/c\/.*$/, "/c/..%2F..%2Fworkspace.json"));
  check(escape.status === 403 || escape.status === 404, "preview can't escape clients/");
}

r = await b.call("check_figma_file", { client: "acme-outdoors", file: "https://www.figma.com/design/2QGsznyC6myiv41zPJlSxu/x" });
check(!r.isError, "check_figma_file accepts the client's file", r.text);
r = await b.call("check_figma_file", { client: "acme-outdoors", file: "https://www.figma.com/design/ZZZotherClientFile1/x" });
check(r.isError, "check_figma_file refuses another file");

r = await b.call("list_emails", { client: "acme-outdoors" });
const grouped = r.data.emails?.find((x) => x.email === "spring-campaign/spring-teaser");
check(!r.isError && grouped?.test_values_in_place === 2, "list_emails finds grouped email", r.text);
r = await b.call("update_client", { client: "acme-outdoors", litmus_address: null, notes: "updated" });
check(!r.isError && r.data.config.litmus.address === null, "update_client", r.text);

const layout = { emailqaOutline: 1, frame: { id: "1:1", name: "Email", w: 600, h: 900 }, liveText: 0, outlinedTextGroups: 1, nodes: [
  { id: "1:1", name: "Email", type: "FRAME", depth: 0, x: 0, y: 0, w: 600, h: 900, fill: "#ffffff" },
  { id: "1:2", name: "Hero illustration", type: "RECTANGLE", depth: 1, x: 40, y: 120, w: 520, h: 300, fill: "IMAGE", blend: "LINEAR_BURN" },
  { id: "1:3", name: "Get your home sparkling clean this spring with our team", type: "GROUP", depth: 1, x: 40, y: 60, w: 400, h: 40, outlinedText: true, fill: "#1a1a1a" },
] };
writeFileSync(path.join(dirs.src, "layout.json"), JSON.stringify(layout));
r = await b.call("summarize_design", { file_path: path.join(dirs.src, "layout.json") });
check(!r.isError && /@40,120 520x300/.test(r.data.outline) && /BLEND:LINEAR_BURN/.test(r.data.outline), "summarize_design shows positions and blend modes", r.text);
check(r.data.warnings?.[0]?.startsWith("ALL TEXT IS CONVERTED"), "outlined-text warning comes first");

const oldProject = process.env.EMAILQA_OLD_PROJECT;
if (oldProject && existsSync(path.join(oldProject, "pipeline.json"))) {
  r = await b.call("import_old_project", { path: oldProject });
  check(!r.isError && r.data.emails_copied.length > 0, "import_old_project copies an old project", r.text);
  if (!r.isError && r.data.emails_copied[0]) {
    const imported = { client: r.data.client, email: r.data.emails_copied[0] };
    const p = await b.call("precheck_email", { ...imported, check_urls: false });
    const contrastCheck = p.data.checks?.find((c) => /contrast/i.test(c.check));
    console.log(`      imported email contrast: ${contrastCheck?.detail}`);
    check(contrastCheck?.pass === true, "no contrast false positives on an email Litmus passed (0 WCAG issues)", contrastCheck?.detail);
  }
}

// ---------- fix plans, lessons and test variants ----------
{
  const C = "acme-outdoors";
  const E = "plan-test";
  const pDir = path.join(ws, "clients", C, "emails", E);
  r = await b.call("new_email", { client: C, name: "Plan Test" });
  check(!r.isError && r.data.email === E, "plan: new_email", r.text);
  const variantMjml = (extra = "") => `<mjml lang="en"><mj-head><mj-title>Plan</mj-title><mj-preview>Plan test preview text for checking variant blocks and fix plans in one single email</mj-preview></mj-head>
<mj-body width="600px"><mj-section><mj-column><mj-text>Intro text</mj-text></mj-column></mj-section>
  <!-- variant band A: control, unchanged -->
  <!-- variant-label -->
  <mj-section background-color="#ff00ff"><mj-column><mj-text>VARIANT band A: control</mj-text></mj-column></mj-section>
  <!-- /variant-label -->
  <mj-section background-color="#f9ca0a"><mj-column><mj-text>BAND-A-TEXT</mj-text></mj-column></mj-section>
  <!-- /variant band A -->
  <!-- variant band B: text as an image -->
  <!-- variant-label -->
  <mj-section background-color="#ff00ff"><mj-column><mj-text>VARIANT band B: image</mj-text></mj-column></mj-section>
  <!-- /variant-label -->
  <mj-section background-color="#f9ca0a"><mj-column><mj-text>BAND-B-TEXT</mj-text></mj-column></mj-section>
  <!-- /variant band B -->${extra}
</mj-body></mjml>`;
  writeFileSync(path.join(pDir, "email.mjml"), variantMjml());

  // lessons
  r = await b.call("find_lessons", { query: "Outlook 2021 white specks photo" });
  check(!r.isError && r.data.matches?.some((m) => /\[failed\] Outlook 2021/.test(m)), "find_lessons returns the seeded failed fixes", r.text);
  check(Array.isArray(r.data.client_behavior), "find_lessons also searches client-behavior.md", r.text);
  r = await b.call("find_lessons", { query: "Outlook 2021 dark white text" });
  check(r.data.client_behavior?.some((m) => /Outlook 2021/.test(m) && /Source:/.test(m)), "find_lessons returns sourced client behavior", r.text);
  check(!existsSync(path.join(ws, "library", "client-behavior.md")), "client-behavior.md stays in the plugin, not copied into the workspace");
  check(/emailqa-seed/.test(readFileSync(path.join(ws, "library", "lessons.md"), "utf8")), "find_lessons merges the seed lessons into the workspace file once");
  r = await b.call("record_lesson", { kind: "idea", clients: "Gmail App", problem: "Sample lesson for the smoke test", fix: "Nothing, only a test" });
  check(!r.isError && r.data.saved === true, "record_lesson adds a line", r.text);
  r = await b.call("record_lesson", { kind: "idea", clients: "Gmail App", problem: "Sample lesson for the smoke test", fix: "Nothing, only a test" });
  check(!r.isError && r.data.saved === false, "record_lesson skips an identical line", r.text);

  // variants in a build
  r = await b.call("compile_email", { client: C, email: E });
  check(!r.isError && r.data.mjml_errors.length === 0 && r.data.test_variants?.[0] === "band: A, B", "compile_email lists the test variants", r.text);
  r = await b.call("precheck_email", { client: C, email: E, check_urls: false });
  check(r.data.warnings?.some((w) => /Test variants in the email: band \(A, B\)/.test(w)), "precheck warns about test variants", JSON.stringify(r.data.warnings));

  // plan_fixes refusals
  const good1 = {
    problem: "Gmail App Dark Android: band text turns pale green",
    clients: ["Gmail App Dark Android 15"],
    cause: "Gmail Android lightens very dark text and keeps mid-tone backgrounds, so dark green text on yellow turns pale",
    source: "lessons.md Fix log, Better.email dark mode guide",
    fix: "Test the band with its text as an image",
    proof: "qa/v3/gmailapp-dark-band-B.jpg shows dark text on yellow",
    variant_group: "band",
    variants: ["A: control, unchanged", "B: band text as an image"],
  };
  const good2 = {
    problem: "Outlook 2021: white specks on the lower photo",
    clients: ["Outlook 2021"],
    cause: "Lead only: the specks sit on near-black pixels of the photo",
    source: "measured: 15% of the photo is at luma 6 or lower",
    fix: "Raise the darkest pixels of the photo to luma 18",
    proof: "qa/v3/outlook2021-photo.jpg shows no specks",
  };
  r = await b.call("plan_fixes", { client: C, email: E, items: [{ ...good2, cause: "short" }] });
  check(r.isError && /cause is missing or too short/.test(r.text), "plan_fixes refuses a missing cause", r.text);
  r = await b.call("plan_fixes", { client: C, email: E, items: [{ ...good2, source: "none" }] });
  check(r.isError && /no source for the cause/.test(r.text), "plan_fixes refuses a guess without variants", r.text);
  r = await b.call("plan_fixes", { client: C, email: E, items: [{ ...good1, variants: ["A: control", "B: text image"], variant_group: undefined }] });
  check(r.isError && /need a variant_group/.test(r.text), "plan_fixes needs a group name for variants", r.text);
  r = await b.call("plan_fixes", { client: C, email: E, items: [{ ...good2, fix: "Use higher JPEG quality and standard 4:2:0 colour sampling" }] });
  check(r.isError && /already failed/.test(r.text), "plan_fixes refuses a fix that already failed", r.text);
  r = await b.call("plan_fixes", { client: C, email: E, items: [{ ...good2, fix: "Use higher JPEG quality and standard 4:2:0 colour sampling", why_different: "The earlier try used a different encoder and a full range export" }] });
  check(!r.isError, "plan_fixes accepts a repeat with why_different", r.text);
  r = await b.call("plan_fixes", { client: C, email: E, items: [good1, good2] });
  check(!r.isError && r.data.items === 2 && r.data.related_lessons?.[0]?.lessons?.length > 0, "plan_fixes saves a plan and returns related lessons", r.text);

  // add_test must answer the plan
  const test = { litmus_email_id: "1", alerts: 1, findings: ["STILL BROKEN (our email): Gmail App Dark: band text pale green"], open: ["Gmail App Dark: band text pale green"] };
  r = await b.call("update_email_record", { client: C, email: E, add_test: test });
  check(r.isError && /Record what happened to each fix/.test(r.text), "add_test is refused without plan_results", r.text);
  r = await b.call("update_email_record", { client: C, email: E, add_test: { ...test, plan_results: [{ item: 2, result: "failed", evidence: "qa/v3/outlook2021-photo.jpg: specks remain" }] } });
  check(r.isError && /no entry for plan item 1/.test(r.text), "add_test needs every plan item answered", r.text);
  r = await b.call("update_email_record", {
    client: C,
    email: E,
    add_test: {
      ...test,
      plan_results: [
        { item: 1, result: "worked", evidence: "qa/v3/gmailapp-dark-band-B.jpg: dark text on yellow", variants: [{ id: "A", result: "failed" }, { id: "B", result: "worked" }] },
        { item: 2, result: "failed", evidence: "qa/v3/outlook2021-photo.jpg: specks remain" },
      ],
    },
  });
  check(!r.isError && r.data.lessons_written === 2 && r.data.open_problems === 1, "add_test with plan_results writes the lessons", r.text);
  const lessonsText = readFileSync(path.join(ws, "library", "lessons.md"), "utf8");
  check(/\[worked\] Gmail App Dark Android 15 \| Gmail App Dark Android: band text turns pale green \| Fix: band text as an image/.test(lessonsText), "the winning variant is in lessons.md as worked");
  check(/\[failed\] Outlook 2021 \| Outlook 2021: white specks on the lower photo \| Fix: Raise the darkest pixels/.test(lessonsText), "the failed fix is in lessons.md as failed");
  check(!/Fix: control, unchanged/.test(lessonsText), "the control variant is not written as a lesson");

  // resolve_variants
  r = await b.call("resolve_variants", { client: C, email: E, group: "band", keep: "Z" });
  check(r.isError && /no variant "Z"/.test(r.text), "resolve_variants refuses an unknown variant", r.text);
  r = await b.call("resolve_variants", { client: C, email: E, group: "nope", keep: "A" });
  check(r.isError && /No variant group "nope"/.test(r.text), "resolve_variants refuses an unknown group", r.text);
  r = await b.call("resolve_variants", { client: C, email: E, group: "band", keep: "B" });
  const resolved = readFileSync(path.join(pDir, "email.mjml"), "utf8");
  check(!r.isError && r.data.kept === "B" && r.data.removed?.[0] === "A", "resolve_variants keeps the chosen variant", r.text);
  check(resolved.includes("BAND-B-TEXT") && !resolved.includes("BAND-A-TEXT") && !/<!--\s*\/?variant/.test(resolved), "the other variant, the labels and the markers are gone", resolved);
  check(resolved.includes("Intro text") && !/VARIANT band/.test(resolved), "the rest of the email is untouched");
  r = await b.call("compile_email", { client: C, email: E });
  check(!r.isError && !r.data.test_variants && r.data.mjml_errors.length === 0, "the resolved email compiles with no variants left", r.text);

  // broken variant blocks
  writeFileSync(path.join(pDir, "email.mjml"), variantMjml().replace("<!-- /variant band B -->", ""));
  r = await b.call("compile_email", { client: C, email: E });
  check(r.data.variant_problems?.some((x) => /no closing comment/.test(x)), "compile_email reports an unclosed variant", r.text);
  writeFileSync(path.join(pDir, "email.mjml"), variantMjml());
}

r = await b.call("mark_setup_done");
check(!r.isError && JSON.parse(readFileSync(path.join(dirs.data, "machine.json"), "utf8")).setupDone === true, "mark_setup_done writes machine.json");
b.stop();

// ---------- client handoff ----------
// A local https server stands in for two Klaviyo accounts (/company/TEST01/ is the test account, /company/CLIENT1/
// the client's). Needs openssl for a throwaway certificate; skipped without it.
{
  let cert = null;
  try {
    const key = path.join(t, "key.pem");
    const crt = path.join(t, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
    cert = { key: readFileSync(key), cert: readFileSync(crt) };
  } catch {}
  if (!cert) {
    console.log("SKIP  handoff tests (openssl not available)");
  } else {
    const logo = readFileSync(path.join(dirs.src, "logo.png"));
    writePng(path.join(dirs.src, "other.png"), 50, 50, () => [200, 0, 0, 255]);
    const files = {
      "/company/TEST01/images/t-logo.png": logo,
      "/company/CLIENT1/images/c-logo.png": logo,
      "/company/CLIENT1/images/other.png": readFileSync(path.join(dirs.src, "other.png")),
      "/company/CLIENT2/images/c-logo.png": logo,
    };
    const imageServer = https.createServer(cert, (req, res) => {
      const body = files[req.url];
      res.writeHead(body ? 200 : 404, { "content-type": "image/png" });
      res.end(body);
    });
    await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
    const base = `https://127.0.0.1:${imageServer.address().port}`;
    const h = startServer("email-build.mjs", { NODE_TLS_REJECT_UNAUTHORIZED: "0" }); // trust the throwaway certificate
    await h.init();

    const C = "acme-outdoors";
    const E = "handoff-test";
    const testUrl = `${base}/company/TEST01/images/t-logo.png`;
    const clientUrl = `${base}/company/CLIENT1/images/c-logo.png`;
    const hDir = path.join(ws, "clients", C, "emails", E);
    r = await h.call("new_email", { client: C, name: "Handoff Test" });
    check(!r.isError && r.data.email === E, "handoff: new_email", r.text);
    await h.call("import_file", { client: C, email: E, source_path: path.join(dirs.src, "logo.png"), dest: "images/logo.png" });
    writeFileSync(path.join(hDir, "email.mjml"), `<mjml><mj-body><mj-section><mj-column><mj-image src="${testUrl}" alt="Acme" width="120px" /></mj-column></mj-section></mj-body></mjml>`);
    r = await h.call("compile_email", { client: C, email: E });
    check(!r.isError && r.data.mjml_errors.length === 0, "handoff: compile_email", r.text);
    await h.call("update_email_record", { client: C, email: E, patch: { version: 1, klaviyo: { images: { "logo.png": testUrl } } } });

    r = await h.call("pack_images_for_client", { client: C, email: E });
    check(r.isError && /no recorded Litmus test/.test(r.text), "handoff: pack refuses a version that was never tested", r.text);
    await h.call("update_email_record", { client: C, email: E, add_test: { litmus_email_id: "1", alerts: 0, findings: [] } });

    r = await h.call("set_client_klaviyo_account", { client: C, account_name: "Test Account", public_key: "TEST01" });
    check(r.isError && /test account/i.test(r.text), "handoff: the test account is refused as a client account", r.text);
    r = await h.call("set_client_klaviyo_account", { client: C, account_name: "Acme Outdoors", public_key: "CLIENT1" });
    check(!r.isError && r.data.saved.publicKey === "CLIENT1", "handoff: set_client_klaviyo_account", r.text);
    r = await h.call("list_clients");
    check(r.data.clients?.find((x) => x.client === C)?.client_klaviyo?.public_key === "CLIENT1", "handoff: list_clients shows the client's Klaviyo account", r.text);

    r = await h.call("pack_images_for_client", { client: C, email: E });
    const up = r.data.to_upload?.[0];
    check(!r.isError && r.data.to_upload.length === 1 && up.matches_tested_copy === "identical" && existsSync(up.absolute_path), "handoff: pack copies the image and matches it to the tested copy", r.text);
    check(existsSync(r.data.steps_for_handler_absolute) && r.data.images_folder === "emails/handoff-test/handoff/v1/images", "handoff: upload steps written, paths relative to the client folder", r.text);

    r = await h.call("apply_client_image_links", { client: C, email: E, links: [`${base}/company/CLIENT2/images/c-logo.png`] });
    check(r.isError && /aren't from/.test(r.text), "handoff: a link from another account is refused", r.text);
    r = await h.call("apply_client_image_links", { client: C, email: E, links: [testUrl] });
    check(r.isError && /Klaviyo test account/.test(r.text), "handoff: a test-account link is refused", r.text);
    r = await h.call("apply_client_image_links", { client: C, email: E, links: [`${base}/company/CLIENT1/images/other.png`] });
    check(!r.isError && r.data.final_html === null && r.data.no_link_found_for?.length === 1, "handoff: a wrong image matches nothing and writes nothing", r.text);
    r = await h.call("apply_client_image_links", { client: C, email: E, links: [clientUrl] });
    const finalHtml = r.data.final_html_absolute && existsSync(r.data.final_html_absolute) ? readFileSync(r.data.final_html_absolute, "utf8") : "";
    const testedHtml = readFileSync(path.join(hDir, "build", "email.html"), "utf8");
    check(!r.isError && r.data.only_image_links_changed === true && finalHtml === testedHtml.split(testUrl).join(clientUrl), "handoff: final HTML is the tested HTML with only the image link swapped", r.text);
    check(finalHtml.includes("CLIENT1") && !finalHtml.includes("TEST01"), "handoff: no test-account link is left");

    r = await h.call("pack_images_for_client", { client: C, email: E });
    check(!r.isError && r.data.to_upload.length === 0 && r.data.already_in_client_account?.length === 1, "handoff: a second pack reuses the image already in the client's account", r.text);
    r = await h.call("apply_client_image_links", { client: C, email: E });
    check(!r.isError && !!r.data.final_html && r.data.images?.[0]?.reused === true, "handoff: final HTML from the remembered link, no new links needed", r.text);
    {
      const mjmlFile = path.join(hDir, "email.mjml");
      const original = readFileSync(mjmlFile, "utf8");
      writeFileSync(mjmlFile, original.replace("</mj-body>", "<!-- variant x A: a -->\n<!-- /variant x A -->\n<!-- variant x B: b -->\n<!-- /variant x B -->\n</mj-body>"));
      r = await h.call("pack_images_for_client", { client: C, email: E });
      check(r.isError && /still has test variants/.test(r.text), "handoff: pack refuses while test variants are in email.mjml", r.text);
      writeFileSync(mjmlFile, original);
    }
    await h.call("compile_email", { client: C, email: E });
    r = await h.call("pack_images_for_client", { client: C, email: E });
    check(r.isError && /rebuilt after its last Litmus test/.test(r.text), "handoff: pack refuses an email rebuilt after its test", r.text);
    h.stop();
    imageServer.close();
  }
}

// ---------- browser guard ----------
{
  const guard = (tool_name, tool_input, projectDir) =>
    spawnSync(process.execPath, [path.join(root, "scripts", "klaviyo-guard.mjs")], {
      input: JSON.stringify({ tool_name, tool_input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      encoding: "utf8",
    }).status;
  const nav = "mcp__claude-in-chrome__navigate";
  const js = "mcp__claude-in-chrome__javascript_tool";
  const inClient = path.join(ws, "clients", "acme-outdoors");
  check(guard(nav, { url: "https://www.klaviyo.com/campaigns" }, ws) === 2, "guard: blocks a Klaviyo campaigns page in the workspace");
  check(guard(nav, { url: "https://www.klaviyo.com/campaigns" }, inClient) === 2, "guard: blocks it in a client folder too");
  check(guard(nav, { url: "https://www.klaviyo.com/brand-library/images" }, ws) === 0, "guard: allows the Images page");
  check(guard(nav, { url: "https://www.klaviyo.com/email-editor/AbC123/edit" }, ws) === 0, "guard: allows the template editor");
  check(guard(js, { text: "document.querySelector('button').click()" }, ws) === 2, "guard: blocks a script that clicks");
  check(guard(js, { text: "document.title" }, ws) === 0, "guard: allows a read-only script");
  check(guard(nav, { url: "https://www.klaviyo.com/campaigns" }, dirs.session) === 0, "guard: does nothing outside the workspace");
}

// ---------- klaviyo ----------
const k = startServer("klaviyo.mjs");
check((await k.init())?.serverInfo?.name === "klaviyo", "klaviyo starts from the bundle");
r = await k.call("check_connection");
check(r.isError && /No Klaviyo key set/.test(r.text), "klaviyo explains a missing key", r.text);
r = await k.call("upsert_template", { client: "acme-outdoors", email: "spring-campaign/spring-teaser" });
check(r.isError && /local images/.test(r.text), "upsert_template refuses local images before any API call", r.text);
r = await k.call("send_test_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser" });
check(r.isError && /no Klaviyo template/.test(r.text), "send_test_email needs a template first", r.text);
check((await k.tools()).includes("host_images"), "tool host_images listed");
r = await k.call("host_images", { client: "acme-outdoors", email: "spring-campaign/spring-teaser" });
check(!r.isError && r.data.not_hosted?.length === 3 && r.data.not_hosted.every((n) => /No Klaviyo key/.test(n.error)), "host_images finds the img and background references", r.text);
{
  // Litmus rounds: at most 2 per email, and never the same template twice.
  const recordFile = path.join(emailDir, "email.json");
  const rec = JSON.parse(readFileSync(recordFile, "utf8"));
  rec.klaviyo = { ...(rec.klaviyo || {}), templateId: "T1", publishedSha: "s2" };
  rec.litmusSends = [{ version: 1, sha: "s1" }, { version: 2, sha: "s2" }];
  rec.tests = [{ at: "2026-01-01T00:00:00Z", version: 1, open: [] }, { at: "2026-01-02T00:00:00Z", version: 2, open: [] }];
  writeFileSync(recordFile, JSON.stringify(rec));
  const send = (extra) => k.call("send_test_email", { client: "acme-outdoors", email: "spring-campaign/spring-teaser", ...extra });
  r = await send({});
  check(r.isError && /Nothing changed since the last Litmus send/.test(r.text), "send_test_email refuses an unchanged template", r.text);
  rec.klaviyo.publishedSha = "s3";
  writeFileSync(recordFile, JSON.stringify(rec));
  r = await send({});
  check(r.isError && /already used its 2 Litmus rounds/.test(r.text), "send_test_email refuses a third Litmus round", r.text);
  r = await send({ extra_round: true });
  check(r.isError && /No Klaviyo key set/.test(r.text), "extra_round: true allows a third round (stops later at the missing key)", r.text);
}
{
  // Plan guard and confirm round, on a separate email.
  const E = "plan-test";
  const pDir = path.join(emailDir, "..", "..", "plan-test");
  const recordFile = path.join(pDir, "email.json");
  const base = JSON.parse(readFileSync(recordFile, "utf8"));
  const variantsMjml = readFileSync(path.join(pDir, "email.mjml"), "utf8");
  const plain = variantsMjml.replace(/<!-- \/?variant[\s\S]*?-->/g, "");
  const setRecord = (extra) => writeFileSync(recordFile, JSON.stringify({ ...base, plans: [], variantResolution: undefined, klaviyo: { templateId: "T9", publishedSha: "p2" }, version: 2, ...extra }));
  const send = (extra) => k.call("send_test_email", { client: "acme-outdoors", email: E, ...extra });
  const T1 = "2026-02-01T00:00:00Z";
  const T2 = "2026-02-02T00:00:00Z";
  const plan = { at: T2, version: 1, items: [{ problem: "Gmail App Dark: band", clients: ["Gmail"], cause: "c".repeat(20), source: "x".repeat(8), fix: "fix fix fix", proof: "p".repeat(15), variant_group: "band", variants: ["A: control", "B: image"] }] };

  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [] });
  r = await send({});
  check(r.isError && /no recorded review/.test(r.text), "send_test_email: round 2 needs round 1 reviewed and recorded", r.text);
  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [{ at: T1, version: 1, open: ["Gmail App Dark: band text pale green"] }] });
  r = await send({});
  check(r.isError && /needs a fix plan/.test(r.text), "send_test_email: round 2 needs a fix plan when problems are open", r.text);
  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [{ at: T1, version: 1, findings: ["STILL BROKEN (our email): x"] }] });
  r = await send({});
  check(r.isError && /needs a fix plan/.test(r.text), "send_test_email: open problems are also read from the findings", r.text);
  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [{ at: T1, version: 1, open: [] }] });
  r = await send({});
  check(r.isError && /No Klaviyo key set/.test(r.text), "send_test_email: no open problem needs no plan", r.text);
  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [{ at: T1, version: 1, open: ["a problem"] }], plans: [plan] });
  writeFileSync(path.join(pDir, "email.mjml"), plain);
  r = await send({});
  check(r.isError && /promises variants "band"/.test(r.text), "send_test_email: a plan with variants needs the variant blocks", r.text);
  writeFileSync(path.join(pDir, "email.mjml"), variantsMjml);
  r = await send({});
  check(r.isError && /No Klaviyo key set/.test(r.text), "send_test_email: a plan with its variant blocks passes the guard", r.text);
  setRecord({ litmusSends: [{ version: 1, sha: "p1" }], tests: [{ at: T2, version: 1, open: ["a problem"] }], plans: [{ ...plan, at: T1 }] });
  r = await send({});
  check(r.isError && /needs a fix plan/.test(r.text), "send_test_email: a plan older than the last review does not count", r.text);

  // Confirm round after resolve_variants: allowed once, on top of the two rounds.
  const two = { litmusSends: [{ version: 1, sha: "p1" }, { version: 2, sha: "p2x" }], tests: [{ at: T1, version: 1, open: ["a problem"] }, { at: T2, version: 2, open: [] }] };
  setRecord({ ...two, variantResolution: { at: "2026-02-03T00:00:00Z", groups: ["band"], confirmUsed: false } });
  r = await send({});
  check(r.isError && /No Klaviyo key set/.test(r.text), "send_test_email: one confirm round is allowed after resolve_variants", r.text);
  setRecord({ ...two, variantResolution: { at: "2026-02-03T00:00:00Z", groups: ["band"], confirmUsed: true } });
  r = await send({});
  check(r.isError && /already used its 2 Litmus rounds/.test(r.text), "send_test_email: the confirm round is used only once", r.text);
  setRecord({ ...two, variantResolution: { at: "2026-02-01T12:00:00Z", groups: ["band"], confirmUsed: false } });
  r = await send({});
  check(r.isError && /already used its 2 Litmus rounds/.test(r.text), "send_test_email: a resolve before the last review gives no confirm round", r.text);
}
k.stop();

// ---------- figma launcher ----------
let f = startServer("figma.mjs");
await f.init();
const fTools = await f.tools();
check(fTools.length === 1 && fTools[0] === "figma_get_status", "figma launcher serves the not-installed placeholder");
r = await f.call("figma_get_status");
check(/isn't installed/.test(r.text), "placeholder explains how to install");
f.stop();

if (process.argv.includes("--figma-install")) {
  const b2 = startServer("email-build.mjs");
  await b2.init();
  r = await b2.call("install_figma_server");
  check(!r.isError && r.data.installed, "install_figma_server", r.text);
  r = await b2.call("prepare_figma_bridge");
  check(!r.isError && r.data.manifest?.endsWith("manifest.json"), "prepare_figma_bridge", r.text);
  b2.stop();
  f = startServer("figma.mjs");
  const fi = await f.init();
  const all = await f.tools();
  check(/Figma Console/i.test(fi?.serverInfo?.name || "") && all.includes("figma_execute") && all.length > 40, `real Figma server starts through the launcher (${all.length} tools)`, f.stderr.slice(-500));
  f.stop();
}

console.log(`\n${failures ? `${failures} FAILED` : "All passed"}  (temp folder: ${t})`);
setTimeout(() => process.exit(failures ? 1 : 0), 2000);
