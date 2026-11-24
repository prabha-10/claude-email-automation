// Shared helpers for the EmailQA servers: tool registration, JSON files, env values, slugs.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

export const VERSION = "0.4.0";

export const now = () => new Date().toISOString();

// Plugin settings arrive as "${user_config.x}" when unset; treat that as empty.
export function envValue(name) {
  const v = (process.env[name] || "").trim();
  return v && !v.startsWith("${") ? v : "";
}

export function registerTools(server) {
  const ok = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  return (name, description, inputSchema, fn) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return ok(await fn(args));
      } catch (e) {
        return fail(e);
      }
    });
}

export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    if (e.code === "ENOENT") throw e;
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

// Write via a temp file so a crash never leaves half a JSON file.
export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, file);
}

export function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
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

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// "https://www.figma.com/design/AbC123/Name?node-id=1-2" -> "AbC123"
export function figmaFileKey(urlOrKey) {
  const s = String(urlOrKey || "").trim();
  const m = s.match(/figma\.com\/(?:design|file|proto|board|slides)\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{10,}$/.test(s)) return s;
  return null;
}
