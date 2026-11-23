---
name: check-setup
description: Check that Email Template Tester is ready on this computer — install problems (a second Figma server, missing packages), Figma Desktop Bridge, Klaviyo key, Litmus test address, Litmus login in Chrome, and whether the current folder is an email project. Use on first run, when a step fails to connect, when a setup warning appeared at session start, or when the user asks to check the setup.
---

# Check Email Template Tester setup

Run the five checks below, then report one table: check, status, and the fix for anything that failed. Never ask for or print passwords or API keys. Don't change the user's Claude or MCP config yourself: give them the fix and let them run it.

## 1. Install

Call `check_install` (email-build server).

- `ok: true`: pass.
- Each item in `problems` has a `problem` and a `fix`. Report both as given.
- If the email-build tools aren't available at all, the plugin's packages didn't install. Fix: `/plugin uninstall email-template-tester@email-template-tester`, then `/plugin install email-template-tester@email-template-tester`, then restart Claude Code.

## 2. Figma

Call `figma_get_status` with `probe: true`.

- Connected, probe succeeds: pass. Note the file name.
- No plugin connected: ask the user to open the design file in Figma Desktop and run the Desktop Bridge plugin. First time only: Figma Desktop → Plugins → Development → Import plugin from manifest, and choose `~/.figma-console-mcp/plugin/manifest.json`.
- Port fallback (e.g. 9224) or other instances listed: another Figma server is running. If check 1 found a second Figma server, that's the cause; otherwise ask the user to close other Claude sessions that read Figma.

## 3. Klaviyo

Call `check_connection` (klaviyo server).

- `key_works: true`: pass. Report `key_source` and `test_recipients_allowed`, and any `warning`.
- No key: the user sets it with `/plugin configure email-template-tester@email-template-tester`, or gives this brand its own key (see the new-project skill).
- HTTP 401/403: the key is wrong or lacks permissions. It needs Images: Full access and Templates: Full access.
- `test_recipients_allowed: 0`: test sends won't work until the user adds their Litmus test address in `/plugin configure`.

## 4. Litmus in Chrome

Load the Chrome tools in one ToolSearch call, call `tabs_context_mcp`, open your own tab at https://litmus.com/home, and wait a few seconds.

- A "Recent emails" list is visible: pass.
- A login page: ask the user to log in to Litmus in Chrome. Never type credentials.

Close your tab afterwards.

## 5. Project folder

Call `list_emails` (email-build server).

- Returns a brand: this folder is an email project; report how many emails it has.
- "No pipeline.json": this folder isn't a project yet. Suggest the new-project skill, after checking with the user that this is the right folder.
