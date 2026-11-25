---
name: build-email
description: Build one email from a Figma frame into MJML and compiled HTML inside a client's folder in the EmailQA workspace. Check it locally with pre-checks and a 600px, 375px and dark-mode preview, then make the user's requested changes. Triggers: the user selects a Figma frame or pastes a frame link and asks to build, convert or code an email. Another trigger is a request for layout, copy or style changes to an email.
---

# Build an email from Figma

One email at a time, for one client. Every EmailQA tool takes `client` (folder name) and `email` (a path such as `spring-sale` or `black-friday/teaser`). If there is no workspace or client yet, use the start skill first.

Read [mjml-rules.md](mjml-rules.md) before you write any MJML. If the workspace has `library/lessons.md` (team lessons), read it too. `library/mjml-starter.mjml` is a good starting point.

Before you style colours, logos or dark areas, read [library/client-behavior.md](../../library/client-behavior.md). It says what each email client does in dark mode, and which fixes have a source.

Never change the Figma file. Never invent copy: take it from the design. Never use shell commands for files: use `import_file`, `image_info`, `convert_image` and `crop_image`.

Work from start to finish without questions. If step 1 cannot find the frame, ask. Say any guess in one line in the report.

## 1. Find the frame, in the right client's file

- `figma_get_status` with `probe: true`. If it is not connected, use the Figma part of the start skill's setup.
- `figma_list_open_files`: the bridge sees every open file that has the plugin running, from any client or Figma account. Find this client's file and call `check_figma_file` with its file key. If the check fails, ask the user to open the right file. If the user says that the file belongs to this client, add it with `update_client`.
- Pin the file: `figma_navigate` with the file's URL and `lock: true`, so that other files cannot take over. Pass `fileKey` to `figma_execute`.
- The frame: if the user pasted a Figma link with `node-id=197-3`, use node `197:3`. If not, call `figma_get_selection`. Exactly one frame must be selected. If none is selected, ask the user to select the email frame. Note its node ID, name and width.

## 2. Create the email folder

Call `new_email` with the client, a short human name, an optional `group` and `figma_node_id`. Take the name from the frame name, and do not ask. A group is for example a campaign name. Use the returned `email` path everywhere. If the email exists, you are rebuilding it: read its `email.json` first.

## 3. Read the design

- `figma_capture_screenshot` of the frame at scale 1. Claude Code saves the image to a file and shows its path. Copy it with `import_file` to `design/figma.png`. This is the reference for every later comparison. If no path is available, ask the user to export the frame as PNG to Downloads, and import that file.
- Layout: run [figma-outline.js](figma-outline.js) with `figma_execute`. Read the script, replace `__NODE_ID__`, pass `fileKey` and `timeout: 30000`. It gives positions relative to the frame, sizes, blend modes, fonts and text. If the result is too large and goes to a file, call `summarize_design` with that file path. For auto-layout detail, `figma_get_component_for_development_deep` (depth 0) is the other option, and `summarize_design` reads it too.
- Read the `warnings` first:
  - Text converted to outlines: the copy comes from the layer names. Find the fonts, sizes and weights from the screenshot (measure the glyph heights). In the report, say which values you guessed.
  - Blend modes: see step 4.
- Frames that are not 600px wide: scale every size by 600 divided by the frame width, and round font sizes to whole pixels. For example, a 946px frame gives a scale of 0.634, so a 116px headline becomes 74px.
- Freely positioned frames (no auto-layout, `ABSOLUTE` layers): rebuild them as stacked sections from the x and y positions. Overlapping layers become one flattened image (step 4).
- Live text over a photo: cut the photo in two in a quiet area. The top part becomes a `background-url` behind the live text, and the lower part is a normal image. Give the section a background color that matches the photo, as a fallback.

## 4. Export images

For each image node (photos, kept illustrations, icons):

- `figma_capture_screenshot` with the node ID and `scale: 2`, then `import_file` to `images/<descriptive-name>.<ext>`. Use PNG for icons and anything with transparency. Use JPG for photos (`convert_image` turns a PNG into a JPG).
- Blend modes and overlaps: a layer that you export alone loses its blend and whatever is under it. Capture its parent (the band or section), import it to `design/`, and cut the layer out with `crop_image`. Use the layer's x, y, w and h relative to that parent, and the parent's design width.
- A layer that a frame clips exports as the visible part only. Do not crop it a second time.
- Exports stop at 1568px on the longest side. Anything shown wider than 784px therefore comes out below 2x. Say so in the report.
- Run `image_info` on all images. Fix "transparent PNG with dark pixels" warnings, because those parts disappear in dark mode: add a light outline or a solid background. Convert large opaque PNGs to JPG.

## 5. Write the MJML

Write `email.mjml` in the email folder, and follow [mjml-rules.md](mjml-rules.md). Reference local images as `../images/<file>`, so that the local preview works. The test-email skill hosts them later with `host_images`.

Test values: if the design has no real links, footer address or similar values, use values that are clearly fake. Record each with `set_test_values` (a label and the exact value). The pre-check keeps warning until you replace them, so they cannot get into a real send. In the report, say which values are fake.

## 6. Compile, check and preview

- `compile_email`. Fix any MJML errors.
- `precheck_email`. At this stage "Every image URL is absolute https" fails, because the images are still local. That is expected until test-email hosts them. Fix every other failure (contrast and preview text length included), and read the warnings.
- `preview_email`. Take a screenshot of the `compare` page with the browser. It shows 600px, 375px and three client dark frames. Compare it with `design/figma.png`. Fix layout problems, mobile stacking and dark-mode issues before any Litmus test. The `precheck_email` warnings that start with "Dark mode," name the text that the Gmail or Outlook frame makes hard to read. Here a fix costs nothing, but in Litmus it costs a round.
- `update_email_record` with a note such as "Built from Figma node 1:4909, fonts guessed: …".

## 7. Report and iterate

Report in a few lines: what you built, the fonts, anything you simplified from the design (and why), the test values, and the pre-check result. Give the `preview_email` link with `open: true`, so that the user can look too. For each requested change, edit `email.mjml`, run `compile_email`, `precheck_email` and the preview again, and tell the user to refresh.

If the user asked for a build and a test, or says the email looks right, go straight on to the test-email skill.

If you learned something that helps every future email (not just this client), suggest adding it to `library/lessons.md`.
