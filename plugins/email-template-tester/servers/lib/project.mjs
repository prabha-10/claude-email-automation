// Shared helpers: which folder is the project, and keeping file access inside it.
//
// The project is the folder the user opened Claude in (one folder per brand or client).
// It is initialized by the init_project tool, which writes pipeline.json there.
// PROJECT_ROOT or CLAUDE_PROJECT_DIR override the working directory when set.

import { realpath, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function projectRootRaw() {
  return path.resolve(process.env.PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

export async function projectRoot() {
  return realpath(projectRootRaw());
}

// Folders that must never be treated as a project (too broad to fence file access).
export async function assertSafeRoot(root) {
  const home = await realpath(homedir()).catch(() => homedir());
  if (root === path.parse(root).root || root === home) {
    throw new Error(
      `Refusing to use ${root} as a project folder. Open Claude in a dedicated folder for this brand or client, then run init_project.`
    );
  }
}

// Resolve a path relative to the project and refuse anything outside it (symlinks included).
export async function projectPath(p, { mustExist = true } = {}) {
  const root = await projectRoot();
  const abs = path.resolve(root, p);
  let real;
  if (mustExist) {
    real = await realpath(abs);
  } else {
    // Resolve the deepest parent that exists, so a symlinked parent can't escape the project.
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
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`Path must be inside the project folder (${root}): ${p}`);
  }
  return real;
}

export async function readProjectConfig() {
  const root = await projectRoot();
  try {
    return JSON.parse(await readFile(path.join(root, "pipeline.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`pipeline.json is not valid JSON: ${e.message}`);
  }
}

// Tools that write to Klaviyo or the project need an initialized project.
export async function requireProject() {
  const root = await projectRoot();
  await assertSafeRoot(root);
  const config = await readProjectConfig();
  if (!config) {
    throw new Error(`No pipeline.json in ${root}. Run init_project first (once per brand or client folder).`);
  }
  return { root, config };
}

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export function emailDir(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || "")) {
    throw new Error(`Invalid email name "${slug}". Use lowercase letters, numbers and dashes, e.g. "wedding-invite".`);
  }
  return path.join("emails", slug);
}
