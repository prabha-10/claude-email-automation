// Missing information: values that the design does not give, for example a real link, a footer address or a
// promo code. The builder puts a clearly fake test value in its place and records it with set_test_values.
//
// Two kinds, because they cost different amounts later:
// - link: the value is a link address. It is only in href attributes, so a real link can replace it after the
//   Litmus test without a new round. compareWithTested proves that nothing else in the HTML changed.
// - text: the value is visible text. A real value changes what the reader sees, so after a test it needs a new
//   round. The skills ask for text values before the first Litmus round.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export const isLinkValue = (v) => /^(https?:\/\/|mailto:|tel:)/i.test(String(v || "").trim());
export const kindOf = (v) => (isLinkValue(v) ? "link" : "text");
export const isTestDomain = (v) => /\bexample\.(com|org|net)\b/i.test(String(v || ""));

/** The open test values of an email, split by kind, and when the user last saw the list. */
export function missingInfo(record) {
  const open = (record.testValues || []).map((t) => ({ label: t.label, test_value: t.value, kind: kindOf(t.value) }));
  return {
    links: open.filter((x) => x.kind === "link"),
    text: open.filter((x) => x.kind === "text"),
    asked_at: record.missingInfo?.askedAt || null,
    answered: (record.answeredValues || []).length,
  };
}

/** A real value that can replace a test value, or the reason it cannot. */
export function realValueProblem(kind, real) {
  const v = String(real || "").trim();
  if (v.length < 2) return "The real value is empty.";
  if (isTestDomain(v)) return "example.com is a test domain, not a real value.";
  if (/["<>]/.test(v)) return 'The real value contains ", < or >.';
  if (kind === "link" && !/^(https:\/\/|mailto:|tel:|\{\{|\{%)/i.test(v)) {
    return "A real link starts with https://, mailto: or tel:, or it is a Klaviyo tag.";
  }
  return null;
}

const URL_CHAR = "A-Za-z0-9_\\-./?=&%#~+:";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces every copy of a test value. A link value must not continue into a longer link. */
export function replaceValue(text, testValue, real, kind) {
  const re = kind === "link" ? new RegExp(`${escapeRe(testValue)}(?![${URL_CHAR}])`, "g") : new RegExp(escapeRe(testValue), "g");
  let copies = 0;
  const out = text.replace(re, () => {
    copies++;
    return real;
  });
  return { text: out, copies };
}

const HREF = /(\bhref\s*=\s*)("[^"]*"|'[^']*')/gi;

/** Splits HTML into the parts outside href values, and the href values. */
function splitHrefs(html) {
  const rest = [];
  const hrefs = [];
  let last = 0;
  for (const m of html.matchAll(HREF)) {
    const start = m.index + m[1].length;
    rest.push(html.slice(last, start));
    hrefs.push(m[2].slice(1, -1));
    last = start + m[2].length;
  }
  rest.push(html.slice(last));
  return { rest, hrefs };
}

const plainAmp = (s) => s.replace(/&amp;/g, "&");

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40));
  return `tested ${cut(a)}, now ${cut(b)}`;
}

/**
 * Compares the tested HTML with the current HTML. The change is "link only" when everything outside the href
 * values is identical, and each changed href replaces a recorded test value with a real link.
 */
export function compareWithTested(tested, current, testValues) {
  if (tested === current) return { same: true, link_only: true, changed_links: [] };
  const a = splitHrefs(tested);
  const b = splitHrefs(current);
  if (a.hrefs.length !== b.hrefs.length) {
    return { same: false, link_only: false, reason: `The number of links changed from ${a.hrefs.length} to ${b.hrefs.length}.` };
  }
  for (let i = 0; i < a.rest.length; i++) {
    if (a.rest[i] !== b.rest[i]) {
      return { same: false, link_only: false, reason: `Text or code outside the link addresses changed: ${firstDifference(a.rest[i], b.rest[i])}.` };
    }
  }
  const known = new Set(testValues.map(plainAmp));
  const changed = new Map();
  for (let i = 0; i < a.hrefs.length; i++) {
    if (a.hrefs[i] === b.hrefs[i]) continue;
    if (!known.has(plainAmp(a.hrefs[i]))) {
      return { same: false, link_only: false, reason: `A link changed that was not a test value: ${a.hrefs[i]} became ${b.hrefs[i]}.` };
    }
    if (isTestDomain(b.hrefs[i])) {
      return { same: false, link_only: false, reason: `A test link became another test link: ${b.hrefs[i]}.` };
    }
    changed.set(a.hrefs[i], b.hrefs[i]);
  }
  return { same: false, link_only: true, changed_links: [...changed].map(([test_value, real]) => ({ test_value, real })) };
}

/**
 * What changed in build/email.html since the version that Litmus tested. The tested HTML is the copy that
 * upsert_template saved in qa/v<version>/published.html. Older emails have no copy: then the answered values
 * are put back in the current HTML, and the result must match the hash of the tested HTML.
 */
export async function changeSinceTest(emailDir, record, html) {
  const testedSha = record.klaviyo?.publishedSha || null;
  if (!testedSha) return { same: false, link_only: false, reason: "The record has no hash of the tested HTML." };
  if (sha256(html) === testedSha) return { same: true, link_only: true, changed_links: [] };
  const answered = record.answeredValues || [];
  const testValues = [...answered.map((a) => a.test_value), ...(record.testValues || []).map((t) => t.value)];
  const copy = await readFile(path.join(emailDir, "qa", `v${record.version}`, "published.html"), "utf8").catch(() => null);
  if (copy !== null && sha256(copy) === testedSha) return compareWithTested(copy, html, testValues);

  // Only the links answered after the tested publish can explain a change since then.
  const publishedAt = new Date(record.klaviyo?.publishedAt || 0);
  const links = answered.filter((a) => a.kind === "link" && new Date(a.at) > publishedAt);
  if (!links.length) return { same: false, link_only: false, reason: "The HTML changed, and no link answered after the test explains the change." };
  let back = html;
  for (const a of links) {
    for (const form of new Set([a.real, a.real.replace(/&(?!amp;)/g, "&amp;")])) back = back.split(form).join(a.test_value);
  }
  if (sha256(back) !== testedSha) return { same: false, link_only: false, reason: "The HTML changed in more places than the answered links." };
  const outside = splitHrefs(html).rest.join("");
  const visible = links.filter((a) => outside.includes(a.real) || outside.includes(a.real.replace(/&(?!amp;)/g, "&amp;")));
  if (visible.length) return { same: false, link_only: false, reason: `These links are also in visible text: ${visible.map((a) => a.real).join(", ")}.` };
  return { same: false, link_only: true, changed_links: links.map((a) => ({ test_value: a.test_value, real: a.real })) };
}
