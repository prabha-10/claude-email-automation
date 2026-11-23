// Client handoff helpers (pure functions, no file or network access).
//
// The tested email uses images hosted in our test Klaviyo account. For the client, the same image
// files are uploaded to the client's Klaviyo account by a person (the "handler"), who pastes the new
// links back. These helpers:
//   - identify an image file (format, pixel size, SHA-256) from its bytes
//   - match the pasted client links to the packed files by content, so links can come in any order
//   - swap the test links for the client links and prove that nothing else in the HTML changed

import { createHash } from "node:crypto";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------- image identity ----------

function pngSize(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
  return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10) return null;
  const head = b.toString("ascii", 0, 6);
  if (head !== "GIF87a" && head !== "GIF89a") return null;
  return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // markers without a length field
      continue;
    }
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (i + 8 >= b.length) return null;
      return { format: "jpg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** Format, pixel size and SHA-256 of an image file's bytes. format/width/height are null if unknown. */
export function imageInfo(bytes) {
  const b = Buffer.from(bytes);
  const size = pngSize(b) || jpegSize(b) || gifSize(b) || { format: null, width: null, height: null };
  return { ...size, bytes: b.length, sha256: sha256(b) };
}

const describe = (i) => `${i.format || "unknown type"} ${i.width && i.height ? `${i.width}x${i.height}` : "unknown size"}`;
const sameShape = (a, b) => !!a.width && a.format === b.format && a.width === b.width && a.height === b.height;

// ---------- which account a Klaviyo image link belongs to ----------

/** Klaviyo image links contain /company/<account id>/. Returns that id, or null for other links. */
export function accountIdOf(url) {
  try {
    const m = new URL(url).pathname.match(/\/company\/([^/]+)\//i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ---------- matching pasted links to packed files ----------

/**
 * packed:   [{ file, packedAs, testUrl, sha256, width, height, format }]
 * fetched:  [{ url, sha256, width, height, format }]   the downloaded client links
 * explicit: { "<packedAs or file>": "<url>" }           the handler said which link is which
 *
 * Returns { matches, unmatchedFiles, unusedLinks, problems }. Each match has `how`:
 *   "identical"  the link serves exactly the bytes that were tested
 *   "same-size"  different bytes, same format and pixel size (Klaviyo re-compressed the upload)
 * Nothing is guessed: a same-size match by content is only made when it is the only candidate.
 */
export function matchLinks(packed, fetched, explicit = {}) {
  const matches = [];
  const problems = [];
  const done = new Set(); // packedAs handled (matched or failed)
  const used = new Set(); // client urls used
  const byUrl = new Map(fetched.map((f) => [f.url, f]));
  const add = (p, f, how) => {
    matches.push({ file: p.file, packedAs: p.packedAs, testUrl: p.testUrl, clientUrl: f.url, how });
    done.add(p.packedAs);
    used.add(f.url);
  };

  // 1. Links the handler assigned to a file by name.
  for (const p of packed) {
    const url = explicit[p.packedAs] || explicit[p.file];
    if (!url) continue;
    const f = byUrl.get(url);
    if (!f) problems.push(`${p.packedAs}: the link given for it wasn't downloaded: ${url}`);
    else if (f.sha256 === p.sha256) add(p, f, "identical");
    else if (sameShape(f, p)) add(p, f, "same-size");
    else problems.push(`${p.packedAs}: the link given for it is a different image (${describe(f)}, expected ${describe(p)}): ${url}`);
    done.add(p.packedAs);
  }

  // 2. Byte-identical links. One link may serve several files if they are the same image.
  for (const p of packed) {
    if (done.has(p.packedAs)) continue;
    const f = fetched.find((x) => x.sha256 === p.sha256);
    if (f) add(p, f, "identical");
  }

  // 3. Re-compressed uploads: same format and pixel size, only when unambiguous.
  for (const p of packed) {
    if (done.has(p.packedAs) || !p.width) continue;
    const links = fetched.filter((f) => !used.has(f.url) && sameShape(f, p));
    const files = packed.filter((q) => !done.has(q.packedAs) && sameShape(q, p));
    if (links.length === 1 && files.length === 1) add(p, links[0], "same-size");
  }

  return {
    matches,
    unmatchedFiles: packed.filter((p) => !done.has(p.packedAs)).map((p) => `${p.packedAs} (${describe(p)})`),
    unusedLinks: fetched.filter((f) => !used.has(f.url)).map((f) => `${f.url} (${describe(f)})`),
    problems,
  };
}

// ---------- swapping links ----------

const escapeAmp = (s) => s.replace(/&/g, "&amp;");
const variantsOf = ({ testUrl, clientUrl }) =>
  testUrl.includes("&") || clientUrl.includes("&")
    ? [
        [testUrl, clientUrl],
        [escapeAmp(testUrl), escapeAmp(clientUrl)],
      ]
    : [[testUrl, clientUrl]];

/**
 * Replace every occurrence of each test link with its client link: img src, background attributes,
 * CSS url() and Outlook VML alike. `onlyLinksChanged` is the proof: with every test link blanked out
 * of the original and every client link blanked out of the result, the two must be identical.
 */
export function swapLinks(html, pairs) {
  let out = html;
  const counts = {};
  for (const p of pairs) {
    let n = 0;
    for (const [from, to] of variantsOf(p)) {
      const parts = out.split(from);
      n += parts.length - 1;
      out = parts.join(to);
    }
    counts[p.testUrl] = n;
  }
  const blank = (s, urls) => [...urls].sort((a, b) => b.length - a.length).reduce((acc, u) => acc.split(u).join("\u0000"), s);
  const testSide = pairs.flatMap((p) => variantsOf(p).map(([from]) => from));
  const clientSide = pairs.flatMap((p) => variantsOf(p).map(([, to]) => to));
  return {
    html: out,
    counts,
    leftovers: pairs.filter((p) => variantsOf(p).some(([from]) => out.includes(from))).map((p) => p.testUrl),
    onlyLinksChanged: blank(html, testSide) === blank(out, clientSide),
  };
}

/** Every http(s) link in the HTML that looks like an image (by file extension or an /images/ path). */
export function imageUrlsIn(html) {
  const found = html.match(/https?:\/\/[^\s"'()<>]+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/&amp;/g, "&")))].filter(
    (u) => /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(u) || /\/images\//i.test(u)
  );
}
