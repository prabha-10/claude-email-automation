---
name: build-email
description: Build emails from Figma frames into MJML and compiled HTML inside a client's folder in the EmailQA workspace. Several frames build at the same time, one agent per email. Check each email locally with pre-checks and a 600px, 375px and dark-mode preview, then make the user's requested changes. Triggers: the user selects one or more Figma frames or pastes frame links and asks to build, convert or code emails. Another trigger is a request for layout, copy or style changes to an email.
---

# Build an email from Figma

One client at a time. Steps 1 to 7 build one email. For two or more frames, see "Several emails" at the end. Every EmailQA tool takes `client` (folder name) and `email` (a path such as `spring-sale` or `black-friday/teaser`). If there is no workspace or client yet, use the start skill first.

Read [mjml-rules.md](mjml-rules.md) before you write any MJML. If the workspace has `library/lessons.md` (team lessons), read it too. `library/mjml-starter.mjml` is a good starting point.

Before you style colours, logos or dark areas, read [library/client-behavior.md](../../library/client-behavior.md). It says what each email client does in dark mode, and which fixes have a source.

Never change the Figma file. Never invent copy: take it from the design. Never use shell commands for files: use `import_file`, `image_info`, `convert_image`, `crop_image` and `remove_unused_images`, and edit `email.mjml` with the Edit or Write tool.

Work from start to finish without questions. Ask only in the cases that step 1 names. Say any guess in one line in the report.

## 1. Find the frame, in the right client's file

- `figma_get_status` with `probe: true`. If it is not connected, use the Figma part of the start skill's setup.
- `figma_list_open_files`: the bridge sees every open file that has the plugin running, from any client or Figma account. Find this client's file and call `check_figma_file` with its file key. If the check fails, ask the user to open the right file. If the user says that the file belongs to this client, add it with `update_client`.
- Pin the file: `figma_navigate` with the file's URL and `lock: true`, so that other files cannot take over. Pass `fileKey` to `figma_execute`.
- The frame: if the user pasted a Figma link with `node-id=197-3`, use node `197:3`. If not, call `figma_get_selection`. Note the node ID, name and width of each frame.
- If nothing is selected and the user gave no link, do not ask. Run [figma-frames.js](figma-frames.js) with `figma_execute` and `fileKey`. Build every frame that it marks `email_like`, and say in one line which frames you picked and why. Ask the user in two cases only: no frame is `email_like`, or more than 10 are.
- Two or more frames: do the rest of this step once, then go to "Several emails" at the end of this file.

## 2. Create the email folder

Call `new_email` with the client, a short human name, an optional `group` and `figma_node_id`. Take the name from the frame name, and do not ask. A group is for example a campaign name. Use the returned `email` path everywhere. If the email exists, you are rebuilding it: read its `email.json` first.

## 3. Read the design

- `figma_capture_screenshot` of the frame at scale 1. Claude Code saves the image to a file and shows its path. Copy it with `import_file` to `design/figma.png`. This is the reference for every later comparison. If no path is available, ask the user to export the frame as PNG to Downloads, and import that file.
- The Figma bridge caps every capture at 1568px on the longest side. A frame taller than 1568px therefore comes back below scale 1, and the result gives the real `scale`. Take sizes and positions from the outline, not from the image. If you must measure on the image (text converted to outlines), divide by that scale. For one detail at full size, capture its section node, which is shorter.
- Layout: run [figma-outline.js](figma-outline.js) with `figma_execute`. Read the script, replace `__NODE_ID__`, pass `fileKey` and `timeout: 30000`. It gives positions relative to the frame, sizes, blend modes, fills, borders (`stroke`), fonts, text and underlines. A text layer that mixes styles gets one `run` line per style. If the result is too large and goes to a file, call `summarize_design` with that file path. `summarize_design` also lists `links_in_design`: the real links set in Figma. Use them before any fake link. For auto-layout detail, `figma_get_component_for_development_deep` (depth 0) is the other option, and `summarize_design` reads it too. An extra read-only `figma_execute` for a detail that the outline misses is fine. Say in the report what was missing.
- Read the `warnings` first:
  - Text converted to outlines: the copy comes from the layer names. Find the fonts, sizes and weights from the screenshot (measure the glyph heights). In the report, say which values you guessed.
  - Blend modes: see step 4.
- Frames that are not 600px wide: scale every size by 600 divided by the frame width, and round font sizes to whole pixels. For example, a 946px frame gives a scale of 0.634, so a 116px headline becomes 74px.
- Freely positioned frames (no auto-layout, `ABSOLUTE` layers): rebuild them as stacked sections from the x and y positions. Overlapping layers become one flattened image (step 4).
- Live text over a photo: cut the photo in two in a quiet area. The top part becomes a `background-url` behind the live text, and the lower part is a normal image. Give the section a background color that matches the photo, as a fallback.

## 4. Export images

For each image node (photos, kept illustrations, icons):

- `figma_capture_screenshot` with the node ID and `scale: 2`, then `import_file` to `images/<descriptive-name>.<ext>`. Use PNG for icons and anything with transparency. Use JPG for photos: `convert_image` with `max_width` 1200 (2x a 600px display width) and `quality` 75 to 82. Then remove the PNG with `remove_unused_images`.
- Blend modes and overlaps: a layer that you export alone loses its blend and whatever is under it. Capture its parent (the band or section), import it to `design/`, and cut the layer out with `crop_image`. Use the layer's x, y, w and h relative to that parent, and the parent's design width.
- A layer that a frame clips exports as the visible part only. Do not crop it a second time.
- Exports stop at 1568px on the longest side. Anything shown wider than 784px therefore comes out below 2x. Say so in the report.
- Run `image_info` on all images. Fix "transparent PNG with dark pixels" warnings, because those parts disappear in dark mode: add a light outline or a solid background. Convert large opaque PNGs to JPG, and make files over 1 MB smaller with `convert_image`.
- Before you finish, call `remove_unused_images` with no files to list leftovers, then remove them.

## 5. Write the MJML

Write `email.mjml` in the email folder, and follow [mjml-rules.md](mjml-rules.md). Reference local images as `../images/<file>`, so that the local preview works. The test-email skill hosts them later with `host_images`.

Test values: if the design has no real links, footer address or similar values, use values that are clearly fake. Record each with `set_test_values` (a label and the exact value). The pre-check keeps warning until you replace them, so they cannot get into a real send. In the report, say which values are fake.

- A fake link has the form `https://example.com/?<what>`, for example `https://example.com/?shop`. The pre-check does not fetch example.com links or recorded test values, so they never fail "Link responds".
- To change a recorded value, call `set_test_values` once with `remove` (the old value) and `values` (the new one).
- A design with no footer address gets the footer that [mjml-rules.md](mjml-rules.md) describes under Klaviyo.

## 6. Compile, check and preview

- `compile_email`. Fix any MJML errors.
- `precheck_email`. At this stage "Every image URL is absolute https" fails, because the images are still local. That is expected until test-email hosts them. Fix every other failure, and read the warnings.
- A contrast failure on a colour that you chose (a guessed colour, a fallback) is yours to fix. A contrast failure on a colour from the design is not. Keep the design colour and list it in the report for the designer, with the "nearest passing text colour" that the pre-check gives. That colour also says whether it stays readable in the Gmail and Outlook dark frames.
- `preview_email`. Take a screenshot of the `compare` page with the browser. It shows 600px, 375px and three client dark frames. Each frame is as tall as the email, so scroll for a tall email. To look at one view, open its own URL from `preview_email` (`desktop` or a `dark_` URL), and use `resize_window` with width 375 for mobile. Compare it with `design/figma.png`. Fix layout problems, mobile stacking and dark-mode issues before any Litmus test. The `precheck_email` warnings that start with "Dark mode," name the text that the Gmail or Outlook frame makes hard to read. Here a fix costs nothing, but in Litmus it costs a round.
- `update_email_record` with a note such as "Built from Figma node 1:4909, fonts guessed: …".

## 7. Report and iterate

Report in a few lines: what you built, the fonts, anything you simplified from the design (and why), the test values, and the pre-check result. Give the `preview_email` link with `open: true`, so that the user can look too. For each requested change, edit `email.mjml`, run `compile_email`, `precheck_email` and the preview again, and tell the user to refresh.

If the user asked for a build and a test, or says the email looks right, go straight on to the test-email skill.

If you learned something that helps every future email (not just this client), suggest adding it to `library/lessons.md`.

## Several emails

If the user selects or links two or more frames, build the emails at the same time:

1. Do step 1 once: the status, the client's file and the pin. Note the node ID, name and width of each frame.
2. Call `new_email` for each frame here, in this session, so that two emails never get the same folder. If the frames belong to one campaign, give them the same `group`.
3. Open the browser pane first: `navigate` to `about:blank`. An agent cannot open its own tab while the pane is closed.
4. Start one `emailqa:email-builder` agent per email, all in the same message. Give each agent `client`, `email`, `file_key`, `node_id`, the frame name and width, and `plugin_root`. `plugin_root` is the folder two levels above this skill. Also give the notes from the user that apply to that email. Do not give the agents a tool list: the agent file names the tools to load.
5. Start at most 5 agents in one message. The Figma plugin runs one script at a time, so more agents wait for each other. When the first agents return, start the next ones.
6. When all agents return, call `check_emails` with the list of emails and `open: true`. It compiles and pre-checks every email in one call. It also opens the `overview` page, which shows every email at 600px and 375px with a link to each compare page.
7. Report in one table: the email, the pre-check result, the guesses, the questions for the designer and what is still wrong. Then give the `overview` link. If two agents made different choices for the same thing (a footer, a link, a size), say so and make them the same.

For a change to every email, for example a new footer, edit each `email.mjml`. Then call `check_emails` once, not the three tools per email.

If an agent returns `blocked`, build that email here with steps 3 to 6 after the others finish. If the agent tool is not available, build the emails one after another in this session, then call `check_emails`.

If the user asked for a build and a test, go on to the test-email skill with all the emails.
