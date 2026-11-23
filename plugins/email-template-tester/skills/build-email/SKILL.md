---
name: build-email
description: Build one email from a selected Figma frame into MJML and compiled HTML inside the current email project, then iterate on the user's requested changes. Use when the user selects a Figma frame and asks to build, convert or code an email, or asks for layout, copy or style changes to an email.
---

# Build an email from Figma

One email at a time, inside an email project (a folder with `pipeline.json`). If there is none, use the new-project skill first. Read [mjml-rules.md](mjml-rules.md) before writing any MJML.

Never change the Figma file. Never invent copy; take it from the design.

## 1. Find the frame

- `figma_get_status` with `probe: true`. If it isn't connected, use the check-setup skill's Figma fixes.
- `figma_get_selection`. Exactly one frame must be selected; otherwise ask the user to select the email frame. Note its node ID, name and width (usually 600px).

## 2. Create the email folder

Call `new_email` with a short human name (from the frame name, or ask) and the `figma_node_id`. Use the returned slug for every path below: `emails/<slug>/`. If the email already exists, you're rebuilding it; read `email.json` first.

## 3. Read the design

- `figma_capture_screenshot` of the frame at scale 1. Copy the saved file to `emails/<slug>/design/figma.png`. This is the reference for every later comparison.
- `figma_get_component_for_development_deep` with `depth: 0`. If the result is too large and gets saved to a file, call `summarize_design` with that file path. Read the outline: sections, auto-layout padding and gaps, fills, radii, image nodes (with IDs), and text.
- If `summarize_design` says text was converted to outlines, the copy comes from the group names, and fonts and sizes must be inferred from the screenshot (measure from glyph sizes). Tell the user which fonts and sizes you inferred.

## 4. Export images

For each image node (photos, kept illustrations, icons):

- `figma_capture_screenshot` with the node ID and `scale: 2`. Use JPG for photos without transparency, PNG for icons or anything with transparency (transparent areas may look black in previews; that's fine).
- Exports are capped at 1568px on the longest side, so anything displayed wider than 784px comes out below 2×. Say so.
- Copy each saved file to `emails/<slug>/images/<descriptive-name>.<ext>` with Bash `cp`, and check dimensions with `file`.
- Overlapping or rotated photo collages can't be built in email: export the whole group as one image with one descriptive alt text.

## 5. Write the MJML

Write `emails/<slug>/email.mjml` following [mjml-rules.md](mjml-rules.md). Reference local images as `../images/<file>` so the compiled `build/email.html` previews correctly; the test-email skill swaps in hosted URLs later.

Mark any placeholder content (sample links, a sample footer address) with an HTML comment, and list it for the user.

## 6. Compile and check

- `compile_email` and fix any MJML errors.
- `precheck_email`. At this stage "Every image URL is absolute https" fails because images are still local; that's expected until the test-email skill hosts them. Fix everything else.
- `update_email_record` with a note such as "Built from Figma node 1:4909".
- Give the user the command to preview it (the sandbox can't open files for them):
  ```bash
  open "<project folder>/emails/<slug>/build/email.html"
  ```

## 7. Report and iterate

Report briefly: what was built, fonts used, anything simplified from the design (and why), placeholders, and the pre-check result. For each requested change, edit `email.mjml`, re-run `compile_email` and `precheck_email`, and tell the user to refresh. When the user is happy, suggest the test-email skill.
