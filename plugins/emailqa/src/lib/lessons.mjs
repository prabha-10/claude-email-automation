// The workspace's library/lessons.md keeps what the team learned from real builds and Litmus runs. A "Fix log"
// section at the end holds one line per fix that was tried, including the ones that failed, so nobody tries
// the same failed fix twice:
//
//   - [failed] Outlook 2021 | White specks on near-black photo areas | Fix: photo at exactly 600px | Cause: … | Evidence: … | acme/spring v3, 2026-11-24
//
// kind is worked, failed, inconclusive or idea (known, not yet tried). Fields after the first two are labelled.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pluginRoot } from "./workspace.mjs";

export const KINDS = ["worked", "failed", "inconclusive", "idea"];
const HEADING = "## Fix log";
const SEED_MARKER = "<!-- emailqa-seed:1 -->";
const ENTRY = /^- \[(worked|failed|inconclusive|idea)\] (.+)$/;

const STOP = new Set(
  "the and for with that this from into are was not but all has have its when then than they them their there here out one any can will would should could what which while over under after before about also only just very more most some such text email emails client clients app apps mode".split(" ")
);

export const tokens = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

// Share of the words of `a` that also appear in `b`. A failed lesson often lists several fixes together,
// so a new fix is "the same" when most of its words are already in the failed one.
export function contained(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size < 3) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / x.size;
}

const clean = (s) => String(s ?? "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s\|\s/g, " / ").trim();

export function formatEntry({ kind, clients, problem, fix, cause, evidence, where }) {
  const parts = [clean(clients) || "any client", clean(problem), `Fix: ${clean(fix)}`];
  if (cause) parts.push(`Cause: ${clean(cause)}`);
  if (evidence) parts.push(`Evidence: ${clean(evidence)}`);
  if (where) parts.push(clean(where));
  return `- [${kind}] ${parts.join(" | ")}`;
}

export function parseEntry(line) {
  const m = ENTRY.exec(line);
  if (!m) return null;
  const parts = m[2].split(" | ");
  const field = (label) => (parts.find((p) => p.startsWith(`${label}: `)) || "").slice(label.length + 2);
  return { kind: m[1], clients: parts[0] || "", problem: parts[1] || "", fix: field("Fix"), cause: field("Cause"), evidence: field("Evidence"), line };
}

export const lessonsFile = (ws) => path.join(ws, "library", "lessons.md");

const HEADER = "# Team lessons\n\nGeneric lessons learned from real builds and Litmus runs. The build-email skill reads this file before writing MJML, and the test-email skill reads it before it plans a fix.\n";

// Bullet lines (one per lesson or fix) in the section that starts at the Fix log heading.
function fixLogRange(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start < 0) return { lines, start: -1, end: lines.length };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return { lines, start, end };
}

function insertEntries(text, entries) {
  const fresh = entries.filter((l) => !text.split("\n").some((x) => x.trim() === l.trim()));
  if (!fresh.length) return { text, added: 0 };
  let { lines, start, end } = fixLogRange(text);
  if (start < 0) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("", HEADING, "", "One line per fix that was tried. Failed fixes stay here, so they are not tried again.", "");
    start = lines.lastIndexOf(HEADING);
    end = lines.length;
  }
  // Insert after the last non-blank line of the section.
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...fresh);
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return { text: out, added: fresh.length };
}

// Read the workspace's lessons file. The plugin's seed fix-log lines are merged in once, so workspaces made
// before a seed existed still get it; a line the team deletes later stays deleted.
export async function loadLessons(ws, { write = true } = {}) {
  const file = lessonsFile(ws);
  let text = existsSync(file) ? await readFile(file, "utf8") : HEADER;
  if (!text.includes(SEED_MARKER)) {
    const seed = await readFile(path.join(pluginRoot(), "library", "lessons.md"), "utf8").catch(() => "");
    const seedLines = seed.split("\n").filter((l) => ENTRY.test(l));
    text = insertEntries(text, seedLines).text.replace(/\n*$/, "\n") + `\n${SEED_MARKER}\n`;
    if (write) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  }
  return text;
}

export async function addLessons(ws, entries) {
  const text = await loadLessons(ws);
  const { text: next, added } = insertEntries(text, entries.map(formatEntry));
  if (added) await writeFile(lessonsFile(ws), next);
  return added;
}

export function allEntries(text) {
  return text.split("\n").map(parseEntry).filter(Boolean);
}

// library/client-behavior.md: what each email client does in dark mode and which fixes are documented, with
// sources. The plugin keeps it up to date, so its copy is always searched. A workspace copy (seeded when the
// workspace was made, maybe edited by the team) is searched too. Lines in both count once.
export const CLIENT_BEHAVIOR = "client-behavior.md";

export async function matchClientBehavior(ws, query, { limit = 6 } = {}) {
  const files = [path.join(ws, "library", CLIENT_BEHAVIOR), path.join(pluginRoot(), "library", CLIENT_BEHAVIOR)];
  const seen = new Set();
  const out = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const m of matchLessons(await readFile(file, "utf8"), query, { limit: 50, scored: true })) {
      if (seen.has(m.line)) continue;
      seen.add(m.line);
      out.push(m);
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.line);
}

// Lessons that share words with the query. Fix-log lines and ordinary bullets both count.
export function matchLessons(text, query, { limit = 8, kinds, scored = false } = {}) {
  const q = tokens(query);
  if (!q.size) return [];
  const need = Math.min(2, q.size);
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("- ") || /^- \(example\)/.test(line)) continue;
    const entry = parseEntry(line);
    if (kinds && !(entry && kinds.includes(entry.kind))) continue;
    const t = tokens(line);
    let score = 0;
    for (const w of q) if (t.has(w)) score++;
    if (score >= need) out.push({ score, line: line.slice(2) });
  }
  const best = out.sort((a, b) => b.score - a.score).slice(0, limit);
  return scored ? best : best.map((x) => x.line);
}
