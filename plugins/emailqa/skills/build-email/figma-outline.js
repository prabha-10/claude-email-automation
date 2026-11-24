// Read-only. Run with figma_execute (pass fileKey), after replacing __NODE_ID__ with the frame's node ID.
// Returns a compact layout of the frame: positions relative to the frame, sizes, blend modes, fills,
// auto-layout, fonts and text. It changes nothing in the file.
const root = await figma.getNodeByIdAsync("__NODE_ID__");
if (!root) return { error: "Node not found" };
const box = root.absoluteBoundingBox || { x: 0, y: 0 };
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const fills = (n) => {
  try {
    if (!n.fills || n.fills === figma.mixed) return n.fills === figma.mixed ? "mixed" : undefined;
    const out = n.fills.filter((f) => f.visible !== false).map((f) =>
      f.type === "SOLID" ? hex(f.color) + (f.opacity !== undefined && f.opacity < 1 ? "@" + Math.round(f.opacity * 100) + "%" : "") : f.type
    );
    return out.length ? out.join("+") : undefined;
  } catch (e) {
    return undefined;
  }
};
const nodes = [];
let outlinedTextGroups = 0;
let liveText = 0;
function walk(n, depth) {
  if (nodes.length > 2500) return;
  const b = n.absoluteBoundingBox;
  const e = { id: n.id, name: n.name, type: n.type, depth };
  if (n.visible === false) e.hidden = true;
  if (b) Object.assign(e, { x: Math.round(b.x - box.x), y: Math.round(b.y - box.y), w: Math.round(b.width), h: Math.round(b.height) });
  if (n.rotation) e.rotation = Math.round(n.rotation);
  if (n.blendMode && !["NORMAL", "PASS_THROUGH"].includes(n.blendMode)) e.blend = n.blendMode;
  if (n.opacity !== undefined && n.opacity < 1) e.opacity = Math.round(n.opacity * 100) / 100;
  const f = fills(n);
  if (f) e.fill = f;
  if (n.cornerRadius && n.cornerRadius !== figma.mixed) e.radius = n.cornerRadius;
  if (n.layoutMode && n.layoutMode !== "NONE") {
    e.layout = { mode: n.layoutMode, pad: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft], gap: n.itemSpacing };
  }
  if (n.layoutPositioning === "ABSOLUTE") e.absolute = true;
  if (n.isMask) e.mask = true;
  if (n.type === "TEXT") {
    liveText++;
    e.text = n.characters;
    try {
      if (n.fontName !== figma.mixed) e.font = n.fontName.family + " " + n.fontName.style;
      if (n.fontSize !== figma.mixed) e.size = n.fontSize;
      if (n.lineHeight !== figma.mixed && n.lineHeight.unit !== "AUTO") e.lineHeight = n.lineHeight.value + (n.lineHeight.unit === "PERCENT" ? "%" : "px");
      if (n.letterSpacing !== figma.mixed && n.letterSpacing.value) e.letterSpacing = n.letterSpacing.value + (n.letterSpacing.unit === "PERCENT" ? "%" : "px");
      if (n.textAlignHorizontal) e.align = n.textAlignHorizontal;
      if (n.textCase && n.textCase !== "ORIGINAL") e.textCase = n.textCase;
    } catch (err) {}
  }
  const kids = "children" in n ? n.children : [];
  // Vector-only groups with a real name are usually text converted to outlines.
  if ((n.type === "GROUP" || n.type === "FRAME") && kids.length && kids.every((k) => k.type === "VECTOR") && !/^(group|frame|vector)\s*\d*$/i.test(n.name)) {
    e.outlinedText = true;
    outlinedTextGroups++;
    e.fill = e.fill || fills(kids[0]);
    nodes.push(e);
    return;
  }
  nodes.push(e);
  for (const k of kids) walk(k, depth + 1);
}
walk(root, 0);
return {
  emailqaOutline: 1,
  frame: { id: root.id, name: root.name, w: Math.round(root.width), h: Math.round(root.height) },
  liveText,
  outlinedTextGroups,
  nodes,
};
