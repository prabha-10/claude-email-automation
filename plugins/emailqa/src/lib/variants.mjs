// Test variants: when one problem has several candidate fixes, all of them sit side by side in the test
// email, so one Litmus round shows which one works. Each variant is a block of MJML between two comments:
//
//   <!-- variant band A: control, the current band -->
//   <mj-section> <!-- variant-label --> <mj-section>…label row…</mj-section> <!-- /variant-label --> … </mj-section>
//   <!-- /variant band A -->
//
// The first word after "variant" is the group (one problem), the second is the variant id. Text between a
// "variant-label" pair is a visible label for the reviewer and is removed when a variant is kept.
// resolve_variants keeps one variant per group and deletes the rest. Nothing with a variant block in it can
// be handed to a client.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPEN = /<!--\s*variant\s+([A-Za-z0-9_-]+)\s+([A-Za-z0-9_-]+)\s*(?::([\s\S]*?))?-->/g;
const LABEL = /<!--\s*variant-label\s*-->[\s\S]*?<!--\s*\/variant-label\s*-->/g;

export function parseVariants(text) {
  const found = [];
  const problems = [];
  OPEN.lastIndex = 0;
  for (const m of text.matchAll(OPEN)) {
    const [, group, id, description] = m;
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    const close = new RegExp(`<!--\\s*/variant\\s+${esc(group)}\\s+${esc(id)}\\s*-->`).exec(text.slice(openEnd));
    if (!close) {
      problems.push(`Variant ${group} ${id} has no closing comment <!-- /variant ${group} ${id} -->.`);
      continue;
    }
    const closeStart = openEnd + close.index;
    found.push({ group, id, description: (description || "").trim(), openStart, openEnd, closeStart, closeEnd: closeStart + close[0].length });
  }
  const groups = new Map();
  for (const v of found) {
    if (!groups.has(v.group)) groups.set(v.group, []);
    const list = groups.get(v.group);
    if (list.some((x) => x.id === v.id)) problems.push(`Variant ${v.group} ${v.id} appears twice.`);
    else list.push(v);
  }
  for (const [g, list] of groups) if (list.length < 2) problems.push(`Variant group "${g}" has only one variant. A comparison needs at least two, and one of them is the unchanged control.`);
  return { groups: [...groups].map(([group, variants]) => ({ group, variants })), problems };
}

export function summarizeVariants(text) {
  const { groups, problems } = parseVariants(text || "");
  return {
    count: groups.reduce((n, g) => n + g.variants.length, 0),
    groups: groups.map((g) => ({ group: g.group, ids: g.variants.map((v) => v.id), descriptions: Object.fromEntries(g.variants.map((v) => [v.id, v.description])) })),
    problems,
  };
}

// Keep variant `keep` of `group` (its label rows are removed too) and delete the others.
export function resolveVariants(text, group, keep) {
  const { groups } = parseVariants(text);
  const g = groups.find((x) => x.group === group);
  if (!g) throw new Error(`No variant group "${group}" in email.mjml.${groups.length ? ` Groups found: ${groups.map((x) => x.group).join(", ")}.` : ""}`);
  const winner = g.variants.find((v) => v.id === keep);
  if (!winner) throw new Error(`Group "${group}" has no variant "${keep}". Variants: ${g.variants.map((v) => v.id).join(", ")}.`);

  let out = text;
  // Back to front, so the positions of earlier blocks stay valid.
  for (const v of [...g.variants].sort((a, b) => b.openStart - a.openStart)) {
    // Take the indentation before the opening comment and the line break after the closing one.
    let start = v.openStart;
    while (start > 0 && /[ \t]/.test(out[start - 1])) start--;
    let end = v.closeEnd;
    const tail = /^[ \t]*\r?\n/.exec(out.slice(end));
    if (tail) end += tail[0].length;
    let replacement = "";
    if (v === winner) {
      replacement = out
        .slice(v.openEnd, v.closeStart)
        .replace(LABEL, "")
        .replace(/^(?:[ \t]*\r?\n)+/, "")
        .replace(/\s+$/, "")
        .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
      if (replacement) replacement += "\n";
    }
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return { text: out, kept: keep, removed: g.variants.filter((v) => v !== winner).map((v) => v.id) };
}
