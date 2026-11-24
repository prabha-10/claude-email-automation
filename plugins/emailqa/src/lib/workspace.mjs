// Where things live, and keeping every tool inside one client's folder.
//
// Per computer:  ${CLAUDE_PLUGIN_DATA}/machine.json   setup state, workspace location, Figma server version
// Workspace:     <Email Projects>/workspace.json, library/, clients/<client>/...
// Client:        clients/<client>/client.json, brand/, emails/<email> or emails/<group>/<email>, .cache/

import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envValue, now, readJson, writeJson, slugify, SLUG_RE, figmaFileKey } from "./common.mjs";

// ---------- plugin and data folders ----------

export function pluginRoot() {
  const env = envValue("CLAUDE_PLUGIN_ROOT");
  if (env) return path.resolve(env);
  // dist/<server>.mjs -> plugin root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function dataDir() {
  const env = envValue("EMAILQA_DATA") || envValue("CLAUDE_PLUGIN_DATA");
  return path.resolve(env || path.join(homedir(), ".emailqa"));
}

export function claudeDir() {
  return path.resolve(envValue("CLAUDE_CONFIG_DIR") || path.join(homedir(), ".claude"));
}

const machineFile = () => path.join(dataDir(), "machine.json");

export async function readMachine() {
  return readJson(machineFile(), {});
}

export async function updateMachine(patch) {
  const m = { ...(await readMachine()), ...patch, updated: now() };
  await writeJson(machineFile(), m);
  return m;
}

// ---------- path fencing ----------

const realOr = async (p) => realpath(p).catch(() => path.resolve(p));

export function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

// Resolve p relative to base and refuse anything outside base (symlinks included).
export async function within(base, p, { mustExist = true } = {}) {
  const root = await realpath(base);
  const abs = path.resolve(root, p);
  let real;
  if (mustExist) {
    real = await realpath(abs);
  } else {
    // Resolve the deepest parent that exists, so a symlinked parent can't escape.
    let dir = path.dirname(abs);
    const rest = [path.basename(abs)];
    for (;;) {
      try {
        real = path.join(await realpath(dir), ...rest);
        break;
      } catch {
        rest.unshift(path.basename(dir));
        const up = path.dirname(dir);
        if (up === dir) {
          real = abs;
          break;
        }
        dir = up;
      }
    }
  }
  if (!isInside(root, real)) throw new Error(`Path must stay inside ${root}: ${p}`);
  return real;
}

// ---------- workspace ----------

export function defaultWorkspacePath() {
  return path.join(homedir(), "Email Projects");
}

export async function assertSafeWorkspacePath(p) {
  const abs = path.resolve(p);
  const home = await realOr(homedir());
  const real = await realOr(abs);
  if (real === path.parse(real).root || real === home) {
    throw new Error(`Refusing to use ${real} as the workspace. Pick a dedicated folder such as ${defaultWorkspacePath()}.`);
  }
  for (const forbidden of [pluginRoot(), claudeDir(), dataDir()]) {
    const f = await realOr(forbidden);
    if (isInside(f, real) || isInside(real, f)) {
      throw new Error(`Refusing to use ${real} as the workspace: it overlaps ${f}.`);
    }
  }
  return real;
}

/** True when p may hold a workspace (not the home folder, a drive root, or Claude's or the plugin's folders). */
export async function canBeWorkspace(p) {
  try {
    await assertSafeWorkspacePath(p);
    return true;
  } catch {
    return false;
  }
}

// The folder Claude is opened in is the workspace: that folder (or one of its parents) if it holds
// workspace.json. Only when the session folder can't be a workspace (home folder, drive root) do the
// tools fall back to the workspace recorded at setup. Otherwise a session opened in a new folder would
// silently write client folders somewhere else.
export async function findWorkspace() {
  const start = sessionFolder();
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "workspace.json"))) return realOr(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (await canBeWorkspace(start)) return null;
  const m = await readMachine();
  if (m.workspace && existsSync(path.join(m.workspace, "workspace.json"))) return realOr(m.workspace);
  return null;
}

export async function requireWorkspace() {
  const ws = await findWorkspace();
  if (!ws) {
    throw new Error(
      `This folder (${sessionFolder()}) isn't an EmailQA workspace yet. Call create_workspace with no path to make it one (no need to ask), then continue.`
    );
  }
  const config = await readJson(path.join(ws, "workspace.json"));
  return { ws, config };
}

export function sessionFolder() {
  return path.resolve(envValue("CLAUDE_PROJECT_DIR") || process.cwd());
}

// ---------- clients ----------

export function checkClientSlug(client) {
  if (!SLUG_RE.test(client || "")) {
    throw new Error(`Invalid client "${client}". Use the client's folder name: lowercase letters, numbers and dashes, e.g. "acme".`);
  }
  return client;
}

export async function requireClient(client) {
  const { ws, config: workspace } = await requireWorkspace();
  checkClientSlug(client);
  const dir = path.join(ws, "clients", client);
  let config;
  try {
    config = await readJson(path.join(dir, "client.json"));
  } catch (e) {
    if (e.code === "ENOENT") {
      const known = await listClientSlugs(ws);
      throw new Error(`No client "${client}" in ${path.join(ws, "clients")}. Known clients: ${known.join(", ") || "none"}.`);
    }
    throw e;
  }
  return { ws, workspace, dir: await realpath(dir), config };
}

export async function listClientSlugs(ws) {
  try {
    const entries = await readdir(path.join(ws, "clients"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && existsSync(path.join(ws, "clients", e.name, "client.json"))).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function writeClient(dir, config) {
  await writeJson(path.join(dir, "client.json"), config);
}

export function clientFigmaKeys(config) {
  return (config.figma?.files || []).map((f) => f.fileKey).filter(Boolean);
}

export function figmaFileEntries(urls = []) {
  return urls.map((url) => {
    const fileKey = figmaFileKey(url);
    if (!fileKey) throw new Error(`Not a Figma file URL: ${url}`);
    return { url, fileKey };
  });
}

// ---------- emails ----------

// "spring-sale" or "black-friday/teaser" (up to 3 levels), always forward slashes.
export function checkEmailPath(email) {
  const parts = String(email || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.length > 3 || !parts.every((p) => SLUG_RE.test(p))) {
    throw new Error(
      `Invalid email "${email}". Use its folder path inside the client's emails/ folder, e.g. "spring-sale" or "black-friday/teaser" (lowercase letters, numbers, dashes).`
    );
  }
  return parts.join("/");
}

export function emailPathFromName(name, group) {
  const slug = slugify(name);
  if (!slug) throw new Error(`Can't make a folder name from "${name}".`);
  const groupParts = String(group || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(slugify)
    .filter(Boolean);
  return checkEmailPath([...groupParts, slug].join("/"));
}

export async function emailDir(clientDir, email) {
  const rel = checkEmailPath(email);
  return within(clientDir, path.join("emails", ...rel.split("/")), { mustExist: false });
}

// Resolve a file inside one email folder (e.g. "images/hero.png").
export async function emailFile(clientDir, email, rel, opts) {
  const dir = await emailDir(clientDir, email);
  return within(dir, rel, opts);
}

export async function requireEmail(client, email) {
  const c = await requireClient(client);
  const rel = checkEmailPath(email);
  const dir = await emailDir(c.dir, rel);
  const file = path.join(dir, "email.json");
  let record;
  try {
    record = await readJson(file);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`No email "${rel}" for client "${client}". Create it with new_email first.`);
    throw e;
  }
  return { ...c, email: rel, emailDir: dir, recordFile: file, record };
}

export async function saveRecord(recordFile, record) {
  await writeJson(recordFile, record);
}

// Find every email.json under clients/<client>/emails (max 3 levels).
export async function findEmails(clientDir) {
  const base = path.join(clientDir, "emails");
  const out = [];
  async function walk(dir, parts) {
    if (parts.length > 3) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (parts.length && entries.some((e) => e.isFile() && e.name === "email.json")) {
      out.push(parts.join("/"));
      return; // an email folder never contains other emails
    }
    for (const e of entries) {
      if (e.isDirectory() && SLUG_RE.test(e.name)) await walk(path.join(dir, e.name), [...parts, e.name]);
    }
  }
  await walk(base, []);
  return out.sort();
}

// ---------- Litmus test addresses ----------

// The plugin setting holds one or more base addresses. Litmus folders use "+code" variants of them.
export function litmusBases() {
  return envValue("LITMUS_TEST_ADDRESS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRecipient(addr, bases = litmusBases()) {
  const a = String(addr || "").trim().toLowerCase();
  return bases.some((b) => {
    const [local, domain] = b.split("@");
    if (!local || !domain) return false;
    if (a === b) return true;
    const [aLocal, aDomain] = a.split("@");
    return aDomain === domain && aLocal.startsWith(local + "+") && /^[a-z0-9+._-]+$/.test(aLocal);
  });
}

export async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

export { figmaFileKey };
