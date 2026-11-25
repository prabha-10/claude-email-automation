// Read-only. Run with figma_execute (pass fileKey) when nothing is selected and the user gave no link.
// Lists the top-level frames on the current page, and the frames directly inside top-level sections.
// email_like marks frames 500 to 1400px wide and taller than they are wide. It changes nothing in the file.
const page = figma.currentPage;
const found = [];
for (const n of page.children) {
  if (n.visible === false) continue;
  if (n.type === "SECTION") {
    for (const k of n.children) {
      if (k.type === "FRAME" && k.visible !== false) found.push({ node: k, section: n.name });
    }
  } else if (n.type === "FRAME" || n.type === "COMPONENT") {
    found.push({ node: n });
  }
}
return {
  page: page.name,
  frames: found.map(({ node, section }) => ({
    id: node.id,
    name: node.name,
    w: Math.round(node.width),
    h: Math.round(node.height),
    ...(section ? { section } : {}),
    email_like: node.width >= 500 && node.width <= 1400 && node.height > node.width,
  })),
};
