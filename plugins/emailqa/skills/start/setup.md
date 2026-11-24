# First-run setup

Run the steps in order. Each step checks itself. Fix what you can with the tools. If the user must act, give the exact steps for their OS (`setup_status.os`). Wait for them to say done, then check again and carry on. Never stop at a failure without a next action.

Keep the user informed with one short line per step, for example "Step 3 of 8: Figma bridge". Do not ask questions that a tool can answer.

## 1. Node.js and the plugin servers

If `setup_status` works, Node is fine. Go to step 2.

If the EmailQA tools are not available, check Node with the shell command `node --version`.

- Node is missing or older than 18:
  - Windows: offer to run `winget install OpenJS.NodeJS.LTS` (ask first). If winget is not available, send the user to https://nodejs.org (LTS installer).
  - macOS: send the user to https://nodejs.org (LTS installer), or to `brew install node` for Homebrew users.
  - Then the user must quit Claude completely, open it again, and run /emailqa:start again. On Windows, the desktop app sees the new PATH only after a restart.
- Node is fine but the tools still do not load: the plugin's servers did not start. Ask the user to make sure that only one EmailQA is installed (Customize → Plugins), then to restart Claude. If the problem stays, get the error from `/mcp` (terminal) and report it.

## 2. Duplicate copies and other Figma servers

From `setup_status`:

- `duplicates` failed: two copies start two sets of servers. Tell the user which copy to remove (the `fix` says how). If the fix is a `claude plugin uninstall …` command, offer to run it (ask first). The user must remove the old Email Template Tester plugin.
- `figma-other-servers` failed: a Figma server that the user added competes with the EmailQA server. Give the `fix`, and offer to run `claude mcp remove …` for the user (ask first).

After either change, the user must restart Claude. Continue the setup after the restart.

## 3. Figma server

If `figma-server` failed, call `install_figma_server`. Say that it needs internet once and can take a minute. Then the user must start a new Claude session and run /emailqa:start again, so that the Figma tools load. Before that, finish steps 4, 5, 6 and 7 in this session, because they do not need Figma. In the new session, continue at step 3b.

### 3b. Figma bridge (once per computer)

1. Call `prepare_figma_bridge`. Show its `steps` with the manifest path.
2. Ask the user to do the import and start the bridge in their design file. The user tells you that the bridge panel shows READY.
3. Call `figma_get_status` with `probe: true`:
   - `setup.valid` true and `setup.probeResult.success` true: the step passed. Tell the user the name of the connected file (`transport.websocket.connectedFile.fileName` or `currentFileName`).
   - `failureLayer` 2 (no plugin connected): the bridge is not running in an open file. Ask the user to run it again: right-click → Plugins → Development → Figma Desktop Bridge. Its panel must not be paused.
   - `failureLayer` 1 or `startupError`: the server has no free port, because other Claude sessions hold all 10 Figma ports. Ask the user to close the Claude sessions they do not need, then to start a new session.
   - `pluginUpdateAvailable` true on a connected file: import the manifest again (same steps).
   - If `figma_get_status` only says that the server is not installed, the session is still the old one. Start a new session.
4. Tell the user that the import is once per computer. Later, they only run the Desktop Bridge plugin in the file they work on. With several Figma accounts, they import the plugin once in each account.

## 4. Klaviyo test account

Call `check_connection` (klaviyo server).

- `key_works: true`: the step passed.
- "No Klaviyo key set": the key goes in the plugin settings, never in the chat. In the desktop app, open Customize → Plugins → EmailQA → settings. If there is no settings option, run `claude plugin configure emailqa@<marketplace>` in a terminal, or type `/plugin configure` in a terminal session. The key must come from the agency's Klaviyo test account, never from a client's account. Its custom access is Images Full, Templates Full, and No access for everything else. After the change, the user must start a new session so that the key loads.
- HTTP 401 or 403: the key is wrong or has missing permissions (as above).

## 5. Litmus test address

Look at the `litmus-address` check in `setup_status`. If it failed, the user adds their `...@litmusemail.com` address in the same plugin settings as the key. Test sends can go only to that address and its `+folder` variants.

## 6. Litmus login in Chrome

Load the Claude in Chrome tools in one ToolSearch call, call `tabs_context_mcp`, open your own tab at https://litmus.com/home, and wait a few seconds.

- "Recent emails" shows: the step passed.
- A login page shows: ask the user to log in to Litmus in Chrome (never type credentials), then check again.
- The Chrome tools are not available: the Claude in Chrome extension is not connected. Ask the user to install or turn on the extension in Chrome and connect it to Claude, then check again.

Close your tab afterwards.

## 7. Workspace folder

If the `workspace` check failed, call `create_workspace` with no path. Do not ask. It makes the folder Claude is opened in the workspace, and it keeps the other files in that folder.

The home folder or a drive root cannot be a workspace. In that case, `create_workspace` uses `Email Projects` in the home folder and returns `next`. Tell the user to open future sessions in that folder (desktop app: choose that folder before the first message).

## 8. Finish

Call `setup_status` again. If every check passed (or only checks that the user chose to skip remain), call `mark_setup_done`. Give a short summary table: check, status, and anything still to do. Then go back to step 2 of the start skill.
