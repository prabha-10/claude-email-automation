// WCAG AA text-contrast pre-check on compiled email HTML.
// Uses inline styles and bgcolor attributes only (MJML inlines almost everything); it's an early warning,
// Litmus remains the final word.

import { parseDocument } from "htmlparser2";

const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", gray: "#808080", grey: "#808080", transparent: null };

export function parseColor(v) {
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase().replace(/\s*!important$/, "");
  if (s in NAMED) return NAMED[s] === null ? null : hexRgb(NAMED[s]);
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return hexRgb("#" + [...m[1]].map((c) => c + c).join(""));
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return m[2] === "00" ? null : hexRgb("#" + m[1]);
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha < 0.5) return null;
    return [+m[1], +m[2], +m[3]];
  }
  return undefined;
}

const hexRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

const lum = (c) => {
  const [r, g, b] = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrastRatio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function rgbToHsl([r, g, b]) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => Math.round(v * 255));
}

// The colour nearest to `text` (same hue and saturation, lightness moved in 1% steps) that reaches
// `required` contrast on `background`. `alsoOk(hex)` can add a test, for example the dark-mode frames;
// the nearest colour that passes it wins, else the nearest that passes light mode only.
export function nearestPassingColor(text, background, required, alsoOk = () => true) {
  const t = parseColor(text);
  const bg = parseColor(background);
  if (!t || !bg) return null;
  const [h, s, l] = rgbToHsl(t);
  let lightOnly = null;
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const nl = l + (dir * step) / 100;
      if (nl < 0 || nl > 1) continue;
      const hex = toHex(hslToRgb([h, s, nl]));
      if (contrastRatio(hexRgb(hex), bg) + 1e-9 < required) continue;
      if (alsoOk(hex)) return { color: hex, ratio: +contrastRatio(hexRgb(hex), bg).toFixed(2), dark_ok: true };
      lightOnly ||= { color: hex, ratio: +contrastRatio(hexRgb(hex), bg).toFixed(2), dark_ok: false };
    }
  }
  return lightOnly;
}

function styleMap(el) {
  const out = {};
  for (const part of String(el.attribs?.style || "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function backgroundOf(el, st) {
  const fromStyle = parseColor(st["background-color"]) ?? (st.background ? parseColor((st.background.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b/i) || [])[0]) : undefined);
  if (fromStyle !== undefined) return fromStyle;
  if (el.attribs?.bgcolor) return parseColor(el.attribs.bgcolor);
  return undefined;
}

const HIDDEN_TAGS = new Set(["style", "script", "title", "head", "noscript"]);
const BOLD_TAGS = new Set(["b", "strong", "h1", "h2", "h3", "th"]);

export function checkContrast(html) {
  const doc = parseDocument(html, { decodeEntities: true });
  const issues = new Map();
  let checked = 0;

  function walk(node, ctx) {
    if (node.type === "text") {
      const text = node.data.replace(/\s+/g, " ").trim();
      // Tiny text (<= 2px) is hidden preheader filler. Containers often use font-size:0 (MJML cells), so
      // this is judged on the text's own effective size, never inherited as "hidden".
      if (!text || /^(\{\{.*\}\}|\{%.*%\})$/.test(text) || ctx.hidden || ctx.size <= 2) return;
      checked++;
      const ratio = contrastRatio(ctx.color, ctx.bg);
      const large = ctx.size >= 24 || (ctx.size >= 18.66 && ctx.bold);
      const required = large ? 3 : 4.5;
      if (ratio + 1e-9 < required) {
        const key = `${toHex(ctx.color)}|${toHex(ctx.bg)}|${required}`;
        const issue = issues.get(key) || { color: toHex(ctx.color), background: toHex(ctx.bg), ratio: +ratio.toFixed(2), required, examples: [] };
        if (issue.examples.length < 3) issue.examples.push(text.slice(0, 60));
        issues.set(key, issue);
      }
      return;
    }
    if (node.type !== "tag" && node.type !== "root") return;
    const next = { ...ctx };
    if (node.type === "tag") {
      if (HIDDEN_TAGS.has(node.name)) return;
      const st = styleMap(node);
      if (/none/i.test(st.display || "") || st.opacity === "0" || /hidden/i.test(st.visibility || "") || /all/i.test(st["mso-hide"] || "")) {
        next.hidden = true;
      }
      if (/^0(px)?$/i.test(st["max-height"] || "") && /hidden/i.test(st.overflow || "")) next.hidden = true;
      const bg = backgroundOf(node, st);
      if (bg) next.bg = bg;
      const color = parseColor(st.color) ?? (node.name === "font" ? parseColor(node.attribs?.color) : undefined);
      if (color) next.color = color;
      const fs = (st["font-size"] || "").match(/^([\d.]+)px/);
      if (fs) next.size = parseFloat(fs[1]);
      if (BOLD_TAGS.has(node.name) || /^(bold|[6-9]00)$/i.test(st["font-weight"] || "")) next.bold = true;
      if (/^(normal|[1-5]00)$/i.test(st["font-weight"] || "")) next.bold = BOLD_TAGS.has(node.name);
    }
    for (const child of node.children || []) walk(child, next);
  }

  walk(doc, { color: [0, 0, 0], bg: [255, 255, 255], size: 16, bold: false, hidden: false });
  return { text_nodes_checked: checked, issues: [...issues.values()] };
}
