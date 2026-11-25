// Client-specific dark-mode approximations of a compiled email, for the local preview and the pre-check.
// Each mode rewrites colours the way that client does: inline styles, bgcolor / <font color> / body text
// attributes, and rules in <style> blocks. Images and background images are never recoloured, comments
// (including <!--[if mso]> blocks) are left as they are, and Klaviyo tags ({{ … }}, {% … %}) are kept.
//
// gmail-android: Gmail on Android draws mail in an Android WebView with forced (algorithmic) dark mode,
//   which is Chromium's dark-mode filter. Chromium source, third_party/blink/renderer/platform/graphics/:
//   brightness = (299 R + 587 G + 114 B) / 1000; a background is inverted when brightness > 205, text and
//   borders when brightness < 150 (dark_mode_settings_builder.cc, dark_mode_color_classifier.cc,
//   dark_mode_filter.cc). Inversion = CIELAB L -> min(110 - L, 100), a and b kept, then greys between
//   18 and 32 are set to 18 (dark_mode_color_filter.cc). Matches our black-friday Litmus renders: the
//   #f9ca0a band (brightness 194) stays yellow while its #01501e text turns pale green.
// outlook-windows: classic Outlook (Word engine) has no published rule. Fitted to black-friday Outlook 2021
//   and Outlook 365 dark renders: luma (Rec. 601) is inverted along OUTLOOK_CURVE, the colour offsets from
//   the luma are kept (scaled by 0.65 when the colour gets lighter), and RGB is clipped. Clipping is what
//   turns the #eee820 headline olive and the #f9ca0a band brown. Every colour changes, dark or light, except
//   the background colour of an element whose background image is also drawn in VML (the photo shows there).
//   CSS background images with no VML twin are left out: classic Outlook draws none.
// Both forced modes drop prefers-color-scheme blocks, [data-ogsc]/[data-ogsb] rules and text-shadow.
// apple: Apple Mail applies the email's own @media (prefers-color-scheme: dark) rules. Explicit colours
//   without a dark rule stay; areas with no colour turn dark unless the email says light only.

export const DARK_MODES = [
  {
    id: "apple",
    label: "Apple Mail",
    note:
      "Applies the email's own @media (prefers-color-scheme: dark) rules. Colours without a dark rule stay as they are. " +
      "Areas with no background colour turn dark and default text turns light, unless the email declares color-scheme light only.",
  },
  {
    id: "gmail-android",
    label: "Gmail App Android",
    note:
      "Forced dark of the Android WebView (Chromium's rule). Light backgrounds (brightness above 205 of 255) turn dark. " +
      "Dark text and borders (brightness below 150) turn light. Mid-tone backgrounds and light text stay. Text and background " +
      "change separately, so dark text on a mid-tone band can end up light on light. Ignores prefers-color-scheme and [data-ogsc]/[data-ogsb]. " +
      "text-shadow is left out.",
  },
  {
    id: "outlook-windows",
    label: "Classic Outlook on Windows",
    note:
      "Outlook 2021 / Outlook 365 dark (Word engine): the lightness of every text, background and border colour is inverted, " +
      "the hue is kept. Light text turns dark grey, yellow turns olive or brown, dark areas turn light grey. Images, VML and the colour " +
      "under a VML background image stay. Ignores prefers-color-scheme, [data-ogsc]/[data-ogsb] and text-shadow. " +
      "Calibrated on our Litmus renders, not a published rule.",
  },
];

const MODE_IDS = new Set(DARK_MODES.map((m) => m.id));

// ---------- colour parsing ----------

const NAMED = Object.fromEntries(
  (
    "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 " +
    "blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 " +
    "chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b " +
    "darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b " +
    "darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f " +
    "darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 " +
    "deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 " +
    "fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f " +
    "grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa " +
    "lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff " +
    "lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a " +
    "lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 " +
    "lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd " +
    "mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a " +
    "mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 " +
    "navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 " +
    "palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 " +
    "peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f " +
    "royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d " +
    "silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f " +
    "steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 " +
    "white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32"
  )
    .split(" ")
    .reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [a[i], a[i + 1]]]), [])
);

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => clamp255(v * 255));
}

// Returns { rgb: [r, g, b], a } for a CSS colour token, or null (transparent, currentColor, var(), tags, junk).
export function parseCssColor(token) {
  const s = String(token ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], a: h.length === 8 ? n(6) / 255 : 1 };
  }
  if (NAMED[s]) return parseCssColor("#" + NAMED[s]);
  m = s.match(/^(rgba?|hsla?)\(([^()]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (p) => (/^-?[\d.]+%?$/.test(p) ? parseFloat(p) : NaN);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? num(parts[3]) / 100 : num(parts[3]);
  if (!Number.isFinite(alpha)) return null;
  let rgb;
  if (m[1].startsWith("rgb")) {
    rgb = parts.slice(0, 3).map((p) => (p.endsWith("%") ? num(p) * 2.55 : num(p)));
  } else {
    const h = parseFloat(parts[0]);
    rgb = hslToRgb(h, num(parts[1]) / 100, num(parts[2]) / 100);
  }
  if (rgb.some((v) => !Number.isFinite(v))) return null;
  return { rgb: rgb.map(clamp255), a: Math.max(0, Math.min(1, alpha)) };
}

const toHex = (rgb) => "#" + rgb.map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
const formatColor = ({ rgb, a }) => (a >= 1 ? toHex(rgb) : `rgba(${rgb.map(clamp255).join(", ")}, ${+a.toFixed(3)})`);

// ---------- colour rules ----------

const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const unlin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const WHITE = [0.95047, 1, 1.08883]; // D65
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const labFi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2];
  const [fx, fy, fz] = [x, y, z].map(labF);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116;
  const x = labFi(fy + a / 500) * WHITE[0];
  const y = labFi(fy);
  const z = labFi(fy - b / 200) * WHITE[2];
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const bl = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [r, g, bl].map((v) => clamp255(unlin(Math.max(0, Math.min(1, v)))));
}

// Chromium forced dark (Android WebView), as used by the Gmail app on Android.
function gmailAndroid(rgb, role) {
  const brightness = Math.floor((rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000);
  const invert = role === "background" ? brightness > 205 : brightness < 150;
  if (!invert) return rgb;
  const lab = rgbToLab(rgb);
  lab[0] = Math.min(110 - lab[0], 100);
  const out = labToRgb(lab);
  // Chromium's AdjustGray: dark greys go to the Material dark surface #121212.
  if (Math.abs(out[0] - out[1]) <= 1 && Math.abs(out[0] - out[2]) <= 1 && out[0] < 32 && out[0] > 18) return [18, 18, 18];
  return out;
}

// Luma in -> luma out for classic Outlook on Windows dark mode. Anchors measured on black-friday Litmus renders:
// #1d1d1d -> #dddddd, #244a21 -> #afc9af, #f9ca0a -> #764612, #dbdbdb -> #434343, #fae3b9 -> #4e360c,
// white -> about #222222 (white text and the reading-pane margin).
const OUTLOOK_CURVE = [
  [0, 250],
  [28, 223],
  [58, 190],
  [194, 66],
  [220, 64],
  [255, 34],
];

function outlookWindows(rgb) {
  const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  let t = OUTLOOK_CURVE[OUTLOOK_CURVE.length - 1][1];
  for (let i = 1; i < OUTLOOK_CURVE.length; i++) {
    const [x0, y0] = OUTLOOK_CURVE[i - 1];
    const [x1, y1] = OUTLOOK_CURVE[i];
    if (y <= x1) {
      t = y0 + ((y - x0) / (x1 - x0)) * (y1 - y0);
      break;
    }
  }
  const k = t > y ? 0.65 : 1; // colours that get lighter lose some saturation (#244a21 -> #afc9af)
  return rgb.map((v) => clamp255(t + k * (v - y)));
}

function mapRgb(rgb, mode, role) {
  if (mode === "gmail-android") return gmailAndroid(rgb, role);
  if (mode === "outlook-windows") return outlookWindows(rgb);
  return rgb;
}

// The recoloured colour as CSS text, or null when the client leaves it as it is (the source text is then kept).
function recolor(c, mode, role) {
  const rgb = mapRgb(c.rgb, mode, role);
  return rgb.every((v, i) => v === c.rgb[i]) ? null : formatColor({ rgb, a: c.a });
}

// One CSS colour as it shows in a client's dark mode. role: "text" | "background" | "border".
// Returns the input unchanged when it is not a colour this module understands or the client keeps it.
export function darkColor(color, mode, role = "text") {
  const c = parseCssColor(color);
  return (c && recolor(c, mode, role)) || color;
}

// ---------- CSS values and declarations ----------

const TAG_OPEN = "";
const TAG_CLOSE = "";
const COLOR_FN = /^(rgba?|hsla?)\(/i;
const HEX = /^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w\-])/i;
const WORD = /^[a-z]+(?![\w\-(])/i;

// Replace every top-level colour token in a CSS value. Colours inside url(), gradients and other
// functions are left alone, so background images and gradients keep their colours.
function mapValueColors(value, fn) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < value.length; ) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      const end = value.indexOf(ch, i + 1);
      const stop = end < 0 ? value.length : end + 1;
      out += value.slice(i, stop);
      i = stop;
      continue;
    }
    const prev = i ? value[i - 1] : " ";
    if (depth === 0 && !/[\w\-#]/.test(prev)) {
      const rest = value.slice(i);
      if (COLOR_FN.test(rest)) {
        const close = rest.indexOf(")");
        if (close > 0) {
          const token = rest.slice(0, close + 1);
          const c = parseCssColor(token);
          out += (c && fn(c)) || token;
          i += close + 1;
          continue;
        }
      }
      const hex = rest.match(HEX) || rest.match(WORD);
      if (hex) {
        const c = NAMED[hex[0].toLowerCase()] || hex[0][0] === "#" ? parseCssColor(hex[0]) : null;
        out += (c && fn(c)) || hex[0];
        i += hex[0].length;
        continue;
      }
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    out += ch;
    i++;
  }
  return out;
}

const roleOf = (prop) => {
  if (prop === "color") return "text";
  if (prop === "background" || prop === "background-color") return "background";
  if (/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|column-rule(-color)?)$/.test(prop)) return "border";
  return null;
};

// Split declarations on ";" outside quotes and parentheses (data: URLs contain ";").
function splitDeclarations(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const urlsIn = (value) => [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((m) => m[2].trim());

// Classic Outlook: does this element draw its background image in VML too? Then the photo shows in Outlook and
// the VML fill colour under it is not recoloured, so the background colour is kept as it is.
const hasVmlTwin = (value, ctx) => ctx.mode === "outlook-windows" && urlsIn(value).some((u) => ctx.vmlImages.has(u));

// ctx: { mode, vmlImages: Set<string> }. keepBg: leave background colours alone (see hasVmlTwin).
function transformDeclarations(text, ctx, keepBg = false) {
  if (ctx.mode === "apple") return text;
  const parts = splitDeclarations(text);
  keepBg ||= parts.some((p) => /^\s*background(-image)?\s*:/i.test(p) && hasVmlTwin(p, ctx));
  const out = [];
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 0) {
      out.push(part);
      continue;
    }
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1);
    // Neither client draws text-shadow (classic Outlook doesn't support it; none in our Gmail App renders).
    // Without this, a shadow outline keeps text readable here that is unreadable in the client.
    if (prop === "text-shadow") continue;
    if (ctx.mode === "outlook-windows" && (prop === "background-image" || prop === "background")) {
      // Classic Outlook draws no CSS background images. Keep one only when the email draws the same image in
      // VML (MJML does for section backgrounds); Chrome can't draw VML, so the CSS image stands in for it.
      const urls = urlsIn(value);
      if (urls.length && !urls.every((u) => ctx.vmlImages.has(u))) {
        if (prop === "background-image") continue;
        value = value.replace(/url\([^)]*\)/gi, "none");
      }
    }
    const role = roleOf(prop);
    if (role && !(keepBg && role === "background")) value = mapValueColors(value, (c) => recolor(c, ctx.mode, role));
    out.push(part.slice(0, colon + 1) + value);
  }
  return out.join(";");
}

// ---------- <style> blocks ----------

const OUTLOOK_DATA = /\[\s*data-ogs[cb]\b[^\]]*\]/i;

// Skip a comment or string starting at i; returns the index after it, or i when there is none.
function skipToken(css, i) {
  if (css.startsWith("/*", i)) {
    const end = css.indexOf("*/", i + 2);
    return end < 0 ? css.length : end + 2;
  }
  const ch = css[i];
  if (ch === '"' || ch === "'") {
    for (let j = i + 1; j < css.length; j++) {
      if (css[j] === "\\") j++;
      else if (css[j] === ch) return j + 1;
    }
    return css.length;
  }
  return i;
}

// Index of the "}" closing the block whose "{" is at `open`, or -1 when the CSS is unbalanced.
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; ) {
    const j = skipToken(css, i);
    if (j !== i) {
      i = j;
      continue;
    }
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
    i++;
  }
  return -1;
}

function rewriteSchemeQuery(query, mode) {
  // Apple: dark rules always apply, light-only rules never. Chrome would otherwise follow this computer's setting.
  return mode === "apple"
    ? query.replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, "(min-width: 0px)").replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, "(max-width: 0px)")
    : query.replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, "(max-width: 0px)").replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, "(min-width: 0px)");
}

function transformCss(css, ctx) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    // Copy whitespace and comments.
    const j = skipToken(css, i);
    if (j !== i && css[i] === "/") {
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (/\s/.test(css[i])) {
      out += css[i++];
      continue;
    }
    // Read the prelude up to "{" or ";".
    let k = i;
    while (k < css.length && css[k] !== "{" && css[k] !== ";" && css[k] !== "}") {
      const s = skipToken(css, k);
      k = s !== k ? s : k + 1;
    }
    if (k >= css.length || css[k] !== "{") {
      out += css.slice(i, k + 1); // @import …; or stray text
      i = k + 1;
      continue;
    }
    const prelude = css.slice(i, k);
    const end = blockEnd(css, k);
    if (end < 0) {
      out += css.slice(i); // unbalanced: leave the rest as it is
      break;
    }
    const body = css.slice(k + 1, end);
    const p = prelude.trim().toLowerCase();
    if (p.startsWith("@")) {
      if (/^@(media|supports|document|layer|container)\b/.test(p)) {
        if (/prefers-color-scheme/.test(p) && ctx.mode !== "apple") {
          // Gmail and classic Outlook don't support prefers-color-scheme: drop the whole block.
        } else {
          out += rewriteSchemeQuery(prelude, ctx.mode) + "{" + transformCss(body, ctx) + "}";
        }
      } else {
        out += css.slice(i, end + 1); // @font-face, @keyframes, @page: copied as they are
      }
    } else {
      let selectors = prelude;
      if (ctx.mode !== "apple" && OUTLOOK_DATA.test(prelude)) {
        // [data-ogsc]/[data-ogsb] work only in Outlook.com and the Outlook apps, not in these clients.
        const kept = prelude.split(",").filter((s) => !OUTLOOK_DATA.test(s));
        selectors = kept.length ? kept.join(",") : null;
      }
      if (selectors !== null) out += selectors + "{" + transformDeclarations(body, ctx) + "}";
    }
    i = end + 1;
  }
  return out;
}

// ---------- HTML ----------

const ATTR = /([^\s"'>\/=]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/g;
const COLOR_ATTRS = {
  bgcolor: "background",
  bordercolor: "border",
};

function transformTag(name, attrs, ctx) {
  const tag = name.toLowerCase();
  const style = (attrs.match(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i) || [])[1] || "";
  const bgAttr = (attrs.match(/\sbackground\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i) || [])[1] || "";
  const keepBg = hasVmlTwin(style, ctx) || hasVmlTwin(`url(${bgAttr.replace(/^["']|["']$/g, "")})`, ctx);
  return attrs.replace(ATTR, (whole, attr, eq, raw) => {
    const a = attr.toLowerCase();
    const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : "";
    const value = q ? raw.slice(1, -1) : raw;
    let next = value;
    if (a === "style") next = transformDeclarations(value, ctx, keepBg);
    else if (a === "media") next = rewriteSchemeQuery(value, ctx.mode);
    else if (ctx.mode !== "apple") {
      const role = COLOR_ATTRS[a] || ((tag === "font" || tag === "basefont") && a === "color" ? "text" : null) || (tag === "body" && /^(text|link|vlink|alink)$/.test(a) ? "text" : null);
      if (role && !(keepBg && role === "background")) {
        const c = parseCssColor(value.trim());
        if (c) next = recolor(c, ctx.mode, role) || value;
      }
    }
    return next === value ? whole : attr + eq + q + next + q;
  });
}

const DOC = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>|<!--[\s\S]*?(?:-->|$)|<([a-zA-Z][\w:.-]*)(\s(?:[^>"']|"[^"]*"|'[^']*')*)?>/g;

// Default page colours: elements without an explicit colour sit on the client's own background and text colour.
function pageDefaults(mode) {
  if (mode === "gmail-android") return { background: toHex(gmailAndroid([255, 255, 255], "background")), color: toHex(gmailAndroid([0, 0, 0], "text")) };
  if (mode === "outlook-windows") return { background: toHex(outlookWindows([255, 255, 255])), color: toHex(outlookWindows([0, 0, 0])) };
  return null;
}

const hasDecl = (style, re) => splitDeclarations(style || "").some((d) => re.test(d.slice(0, Math.max(0, d.indexOf(":"))).trim()));

// Does a <style> rule set the body or html background or text colour? Then don't override it inline.
function cssSetsPage(html, re) {
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const r of m[1].matchAll(/(^|[},;\s])((?:html|body)(?:\s*,\s*(?:html|body))*)\s*\{([^}]*)\}/gi)) if (hasDecl(r[3], re)) return true;
  }
  return false;
}

function addPageDefaults(html, mode) {
  const d = pageDefaults(mode);
  if (!d) return html;
  const needBg = !cssSetsPage(html, /^background(-color)?$/i);
  const needColor = !cssSetsPage(html, /^color$/i);
  const body = html.match(/<body\b(\s(?:[^>"']|"[^"]*"|'[^']*')*)?>/i);
  if (!body) {
    if (/<html\b/i.test(html)) {
      const css = `<style>html{${needBg ? `background-color:${d.background};` : ""}${needColor ? `color:${d.color};` : ""}}</style>`;
      return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, css + "</head>") : css + html;
    }
    return `<div style="background-color:${d.background};color:${d.color};">${html}</div>`;
  }
  const attrs = body[1] || "";
  const styleM = attrs.match(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/i);
  const style = styleM ? styleM[2].slice(1, -1) : "";
  const add = [];
  if (needBg && !hasDecl(style, /^background(-color)?$/i) && !/\sbgcolor\s*=/i.test(attrs)) add.push(`background-color:${d.background}`);
  if (needColor && !hasDecl(style, /^color$/i) && !/\stext\s*=/i.test(attrs)) add.push(`color:${d.color}`);
  if (!add.length) return html;
  const merged = (style.trim() ? style.trim().replace(/;?$/, ";") : "") + add.join(";") + ";";
  const newAttrs = styleM ? attrs.replace(styleM[0], `${styleM[1]}"${merged.replace(/"/g, "'")}"`) : `${attrs} style="${merged}"`;
  return html.slice(0, body.index) + `<body${newAttrs}>` + html.slice(body.index + body[0].length);
}

// Does the email allow a dark colour scheme? (meta color-scheme or a CSS color-scheme declaration)
function allowsDark(html) {
  const decl = [
    ...[...html.matchAll(/<meta\b[^>]*name\s*=\s*["']?(?:color-scheme|supported-color-schemes)["']?[^>]*>/gi)].map((m) => (m[0].match(/content\s*=\s*["']([^"']*)["']/i) || [])[1] || ""),
    ...[...html.matchAll(/(?:^|[;{\s])(?:supported-)?color-scheme\s*:\s*([^;}"]*)/gi)].map((m) => m[1]),
  ];
  if (!decl.length) return true; // no declaration: Apple Mail adapts emails with no colours of their own
  return decl.some((v) => /\bdark\b/i.test(v));
}

// HTML for one dark mode. mode: an id from DARK_MODES.
export function simulateDark(html, mode) {
  if (!MODE_IDS.has(mode)) throw new Error(`Unknown dark mode "${mode}". Use one of: ${[...MODE_IDS].join(", ")}.`);
  let src = String(html ?? "");

  // Protect Klaviyo tags: they may contain braces, colons or quotes that look like CSS or HTML.
  const tags = [];
  src = src.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (t) => `${TAG_OPEN}${tags.push(t) - 1}${TAG_CLOSE}`);

  const vmlImages = new Set([...src.matchAll(/<v:(?:fill|image)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].trim()));
  const ctx = { mode, vmlImages };

  let out = src.replace(DOC, (whole, styleAttrs, css, tagName, attrs) => {
    if (css !== undefined) {
      const open = `<style${styleAttrs ? transformTag("style", styleAttrs, ctx) : ""}>`;
      return open + transformCss(css, ctx) + "</style>";
    }
    if (tagName === undefined) return whole; // comment, including <!--[if mso]> blocks
    return attrs ? `<${tagName}${transformTag(tagName, attrs, ctx)}>` : whole;
  });

  if (mode === "apple") {
    if (allowsDark(out)) {
      const css = `<style id="emailqa-dark-apple">:root{color-scheme:dark !important}</style>`;
      out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, css + "</head>") : css + out;
    }
  } else {
    out = addPageDefaults(out, mode);
  }

  return out.replace(new RegExp(`${TAG_OPEN}(\\d+)${TAG_CLOSE}`, "g"), (_, n) => tags[+n]);
}
