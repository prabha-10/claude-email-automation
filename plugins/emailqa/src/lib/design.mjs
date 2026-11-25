// Turn a saved Figma result into a compact outline Claude can read.
// Two inputs are understood:
//   1. The EmailQA layout script (skills/build-email/figma-outline.js via figma_execute): positions, blend modes, fonts.
//   2. figma_get_component_for_development_deep output: auto-layout, fills, fonts (no positions or blend modes).

const hex = (fills) =>
  (Array.isArray(fills) ? fills : [])
    .filter((f) => f.visible !== false)
    .map((f) =>
      f.type === "SOLID" && f.color
        ? "#" + [f.color.r, f.color.g, f.color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
        : f.type
    )
    .join("+");

const clip = (s, n) => {
  s = String(s ?? "").replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

function fromLayout(data, maxLines) {
  const lines = [];
  const images = [];
  const blends = [];
  const links = [];
  const runText = (r) =>
    [r.font, r.size && `${r.size}px`, r.fill, r.decoration, r.link && `link ${r.link}`].filter(Boolean).join(" ") + ` "${clip(r.text, 80)}"`;
  for (const n of data.nodes) {
    if (lines.length >= maxLines) break;
    const pos = n.x !== undefined ? ` @${n.x},${n.y} ${n.w}x${n.h}` : "";
    const bits = [];
    if (n.layout) bits.push(`${n.layout.mode} pad[${n.layout.pad.join(",")}] gap${n.layout.gap}`);
    if (n.absolute) bits.push("ABSOLUTE");
    if (n.fill) bits.push(`fill:${n.fill}`);
    if (n.stroke) bits.push(`stroke:${n.stroke}`);
    if (n.radius) bits.push(`r${n.radius}`);
    if (n.opacity !== undefined) bits.push(`op${n.opacity}`);
    if (n.blend) bits.push(`BLEND:${n.blend}`);
    if (n.rotation) bits.push(`rot${n.rotation}`);
    if (n.mask) bits.push("MASK");
    if (n.hidden) bits.push("HIDDEN");
    if (n.outlinedText) bits.push("[TEXT AS OUTLINES]");
    if (n.text !== undefined) {
      const font = [
        n.font,
        n.size && `${n.size}px`,
        n.lineHeight && `lh ${n.lineHeight}`,
        n.letterSpacing && `ls ${n.letterSpacing}`,
        n.align,
        n.textCase,
        n.decoration,
        n.link && `link ${n.link}`,
        n.runs && `MIXED ${n.runs.length} runs`,
      ]
        .filter(Boolean)
        .join(" ");
      bits.push(`TEXT ${font} "${clip(n.text, 160)}"`);
    }
    for (const u of [n.link, ...(n.runs || []).map((r) => r.link)].filter(Boolean)) {
      if (!links.some((l) => l.url === u)) links.push({ url: u, text: clip(n.runs?.find((r) => r.link === u)?.text || n.text, 60) });
    }
    if (/IMAGE/.test(n.fill || "")) images.push({ id: n.id, name: n.name, size: `${n.w}x${n.h}`, at: `${n.x},${n.y}`, ...(n.blend && { blend: n.blend }) });
    if (n.blend) blends.push({ id: n.id, name: n.name, blend: n.blend });
    const indent = "  ".repeat(n.depth);
    lines.push(`${indent}${n.type} ${n.id} "${clip(n.name, 200)}"${pos} ${bits.join(" ")}`.trimEnd());
    for (const r of n.runs || []) if (lines.length < maxLines) lines.push(`${indent}  run ${runText(r)}`);
  }
  return {
    frame: data.frame,
    outline: lines.join("\n"),
    truncated: lines.length >= maxLines,
    image_nodes: images,
    blend_mode_nodes: blends,
    links_in_design: links,
    live_text_nodes: data.liveText,
    text_as_outlines_groups: data.outlinedTextGroups,
  };
}

function fromDeep(rootNode, maxLines) {
  const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
  const isImage = (n) => (n.fills || []).some?.((f) => f.type === "IMAGE");
  const onlyArt = (n) =>
    (n.type === "VECTOR" && !isImage(n)) || ((n.type === "GROUP" || n.type === "FRAME") && !isImage(n) && (n.children || []).every(onlyArt));
  const firstFill = (n) => (n.type === "VECTOR" ? hex(n.fills) : (n.children || []).map(firstFill).find(Boolean) || "");
  const lines = [];
  const images = [];
  let outlined = 0;
  let live = 0;
  (function walk(n, d) {
    if (lines.length >= maxLines) return;
    const kids = n.children || [];
    const autoLayout = n.layoutMode && n.layoutMode !== "NONE";
    const art = d >= 2 && !autoLayout && onlyArt(n) && count(n) > 3;
    if (isImage(n)) images.push({ id: n.id, name: n.name, size: `${n.width}x${n.height}` });
    const bits = [];
    if (autoLayout) bits.push(`${n.layoutMode} pad[${n.paddingTop ?? 0},${n.paddingRight ?? 0},${n.paddingBottom ?? 0},${n.paddingLeft ?? 0}] gap${n.itemSpacing ?? 0}`);
    const f = hex(n.fills);
    if (f) bits.push(`fill:${f}`);
    if (n.cornerRadius) bits.push(`r${n.cornerRadius}`);
    if (n.opacity !== undefined && n.opacity < 1) bits.push(`op${Math.round(n.opacity * 100) / 100}`);
    if (n._hidden || n.visible === false) bits.push("HIDDEN");
    if (n.type === "TEXT") {
      live++;
      const family = n.fontFamily || n.fontName?.family;
      const style = n.fontStyle || n.fontName?.style;
      const lh = n.lineHeight && typeof n.lineHeight === "object" && n.lineHeight.unit !== "AUTO" ? `lh ${n.lineHeight.value}${n.lineHeight.unit === "PERCENT" ? "%" : "px"}` : "";
      bits.push(`TEXT ${[family, style, n.fontSize && `${n.fontSize}px`, lh, n.textAlignHorizontal].filter(Boolean).join(" ")} "${clip(n.characters, 160)}"`);
    } else if (art) {
      const isText = n.type === "GROUP" && !/^(group|frame|vector)\s*\d*$/i.test(n.name) && kids.every((c) => c.type === "VECTOR");
      if (isText) outlined++;
      bits.push(isText ? `[TEXT AS OUTLINES, color ${firstFill(n)}]` : `[illustration, ${count(n)} nodes, color ${firstFill(n)}]`);
    }
    lines.push(`${"  ".repeat(d)}${n.type} ${n.id} "${clip(n.name, 200)}" ${n.width}x${n.height} ${bits.join(" ")}`.trimEnd());
    if (!art) kids.forEach((k) => walk(k, d + 1));
  })(rootNode, 0);
  return {
    outline: lines.join("\n"),
    truncated: lines.length >= maxLines,
    image_nodes: images,
    live_text_nodes: live,
    text_as_outlines_groups: outlined,
    note_positions: "This format has no x/y positions or blend modes. For freely positioned frames, run skills/build-email/figma-outline.js with figma_execute.",
  };
}

export function summarize(data, maxLines = 400) {
  let result;
  if (data?.emailqaOutline) result = fromLayout(data, maxLines);
  else {
    const rootNode = data?.result?.component || data?.component || data?.node || data?.result || data;
    if (!rootNode?.type) throw new Error("No Figma node found in that file.");
    result = fromDeep(rootNode, maxLines);
  }
  const warnings = [];
  if (result.text_as_outlines_groups > 0 && result.live_text_nodes === 0) {
    warnings.push(
      "ALL TEXT IS CONVERTED TO OUTLINES. Copy comes from layer names; fonts, sizes and weights must be inferred from the screenshot. Tell the user, and ask whether the designer can provide a version with live text."
    );
  } else if (result.text_as_outlines_groups > 0) {
    warnings.push(`${result.text_as_outlines_groups} text group(s) are converted to outlines; infer their font and size from the screenshot.`);
  }
  if (result.blend_mode_nodes?.length) {
    warnings.push(
      "Some layers use blend modes; exported alone they lose the blend. Capture their parent with figma_capture_screenshot and cut the layer out with crop_image (build-email, step 4)."
    );
  }
  return { warnings, ...result };
}
