# EmailQA

A Claude Code plugin that turns a Figma email design into a tested email, then hands it to the client's Klaviyo:

**Figma frame → MJML → local checks and preview → Klaviyo `[TEST]` template → Litmus → review and fix → handoff to the client's Klaviyo**

Built for one person managing many clients. Testing happens in your own **Klaviyo test account** and **Litmus account**. The client's Klaviyo needs no API key: Claude uploads the images and imports the final HTML through the Klaviyo website, in a Chrome where the client's account is logged in, with your OK for each change. Or a person does those steps by hand.

Claude builds and checks. People approve the design and send the real campaign from the client's own account. The plugin cannot send campaigns or email customers.

Works in the Claude desktop app (Code tab) and the terminal, on macOS and Windows.

## What you need

- Claude Code (terminal, the desktop app's Code tab, or VS Code)
- [Node.js](https://nodejs.org) 20 LTS or newer, and git
- Figma Desktop (the app, not the browser)
- Google Chrome with the Claude in Chrome extension, logged in to Litmus (and, for handoffs, to the client's Klaviyo)
- A Klaviyo **test** account (never a client's) and a Litmus account

The quick install below checks these for you and offers to install Node.js and git.

## Install

Once per computer. Never paste a key into a Claude chat: the Klaviyo key is typed into a hidden field.

### Quick install: paste a prompt (recommended)

1. Open a terminal and start Claude Code with `claude`. Do this in the terminal, not the desktop app, because the hidden key field (`/plugin configure`) is a terminal dialog.
2. Paste the prompt below into the Claude session, not into the shell itself.

Claude checks Node.js, git, Figma Desktop and Chrome, and offers to install what's missing (asking first). It then installs the plugin with one command, has you enter your Klaviyo key in the hidden field, and gives you the Figma bridge steps and the commands for daily work.

```text
Set up the "emailqa" Claude Code plugin on this computer, then guide me through first use. Work step by step and tell me what you're doing.

Rules
- Never ask me to paste an API key or password into this chat. The Klaviyo key goes only into the hidden prompt of /plugin configure.
- Ask before installing any software, and show the exact command first.
- Don't change my other Claude Code or MCP settings. If something conflicts, tell me the fix and let me decide.

1. Detect the OS (macOS, Windows or Linux) and use matching commands from here on.

2. Check dependencies and show me a table (found / version / missing):
   - Node.js, recent LTS (v20 or newer), with npm and npx: `node --version`, `npx --version`
   - git: `git --version`
   - Claude Code CLI: `claude --version`
   - Figma Desktop app (macOS: /Applications/Figma.app; Windows: %LOCALAPPDATA%\Figma\Figma.exe)
   - Google Chrome with the Claude in Chrome extension (ask me if you can't tell)
   For missing Node.js or git, offer to install them: macOS `brew install node git` (if Homebrew is missing, point me to nodejs.org and git-scm.com instead); Windows `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git`; Linux via the distro's package manager. Install only after I say yes, then check again. I install Figma Desktop and Chrome myself: give me figma.com/downloads and google.com/chrome.

3. Run `claude mcp list`. The plugin brings its own Figma server (figma-console). If I already added another Figma server, tell me and give me the command to remove it. Don't remove it yourself.

4. Ask me for my Litmus test address (Litmus → Settings → Account → Litmus address, ending in @litmusemail.com). It isn't secret.

5. Install the plugin with one command (it adds the marketplace too):
   claude plugin install emailqa --marketplace prabha-10/claude-email-automation --config litmus_test_address=<my address>
   Then confirm with: claude plugin details emailqa@email-template-tester

6. Klaviyo key. Tell me how to create it, then have me enter it:
   - In my TEST Klaviyo account: Settings → API keys → Create Private API Key → custom access: Images: Full access, Templates: Full access, everything else No access.
   - I type /plugin configure emailqa@email-template-tester in this session and paste the key into the hidden Klaviyo field.
   - Then I quit and reopen Claude Code so the plugin's servers start.

7. Before I restart, give me this guide to keep:

   Figma Desktop Bridge (first time only, after the restart)
   - The plugin's Figma server creates ~/.figma-console-mcp/plugin/manifest.json (Windows: %USERPROFILE%\.figma-console-mcp\plugin\manifest.json) the first time it runs, for example during /emailqa:start.
   - In Figma Desktop: Plugins → Development → Import plugin from manifest… and choose that file.
   - Open the design file and run the Desktop Bridge plugin (Plugins → Development). Keep it running while Claude reads designs. If Claude later says the bridge is outdated, import it again.

   Daily flow, one workspace folder with one folder per client
   - The folder I open Claude in is the workspace. /emailqa:start makes it one without asking, and client folders go inside it.
   - /emailqa:start  → first run: checks the install, installs the Figma server, guides the Figma bridge, checks the Klaviyo key, Litmus address and Litmus login in Chrome. Then it picks the client from my message, the open Figma file, or the only client, and asks only if it cannot tell.
   - Select the email frame in Figma (or paste its link), then /emailqa:build-email
   - /emailqa:test-email  → [TEST] template in my Klaviyo test account, test send to Litmus, review and fixes. At most 2 Litmus rounds per email. A Sonnet agent does the Litmus review.
   - /emailqa:handoff-email  → once approved: images and final template into the client's Klaviyo, after one question that covers the upload and the import
   Plain language works too: "start EmailQA", "build the selected frame", "test it in Litmus", "hand it off to the client".
```

After the restart, the plugin works in the terminal and in the desktop app's Code tab. It is installed for your user, not for one folder. If the desktop app was open during setup, quit and reopen it.

### Manual install

The same steps by hand.

#### 1. Create your Klaviyo key

1. In your **test** Klaviyo account, open **Settings → API keys** and choose **Create Private API Key**.
2. Name it, for example `emailqa`, and choose custom access.
3. Set **Images: Full access** and **Templates: Full access**. Set everything else to **No access**.
4. Create it and copy the key. You will enter it in step 3.

With only these permissions, the key cannot reach lists, profiles, flows or campaigns, even outside this plugin.

#### 2. Get your Litmus test address

In Litmus, open **Settings → Account → Litmus address** and create one. It looks like `yourname@litmusemail.com`. Any email sent there becomes a Litmus test automatically, and it is where the plugin sends test emails.

#### 3. Install the plugin and add your settings

In a terminal, one command adds the marketplace and installs the plugin:

```bash
claude plugin install emailqa --marketplace prabha-10/claude-email-automation --config litmus_test_address=yourname@litmusemail.com
```

Then start `claude` in the terminal and enter the Klaviyo key in the hidden field:

```
/plugin configure emailqa@email-template-tester
```

The key is stored in your system's secure credential store, not in any file. Restart Claude Code so the plugin's servers start.

Inside a Claude Code session you can instead type `/plugin marketplace add prabha-10/claude-email-automation` and then `/plugin install emailqa@email-template-tester`. That install asks for both settings itself.

In the Claude desktop app, use **Customize → Plugins → + Add** and add the GitHub repository `prabha-10/claude-email-automation`. Plugins added there sync to every computer signed in to the same claude.ai account. Change the settings under **Customize → Plugins → EmailQA**.

The plugin brings its own Figma server. If you added a Figma server yourself before, leave it for now: `/emailqa:start` notices it and tells you how to switch it off.

#### 4. Run `/emailqa:start`

The first time on a computer it sets everything else up, one step at a time:

- checks Node, duplicate plugin copies and stray Figma servers
- installs the Figma server (once, needs internet, then you start one new session)
- connects the Figma Desktop Bridge: you import one plugin file in Figma, once per computer. Choose **Plugins → Development → Import plugin from manifest** and pick `~/.figma-console-mcp/plugin/manifest.json` (Windows: `%USERPROFILE%\.figma-console-mcp\plugin\manifest.json`), then run the **Desktop Bridge** plugin in your design file
- checks the Klaviyo key, the Litmus address and the Litmus login in Chrome
- makes the folder you opened Claude in the workspace (other files in it stay as they are)

It remembers that setup is done on this computer. Next time it goes straight to choosing a client.

If you had the old **Email Template Tester** plugin, remove it first (`/plugin uninstall email-template-tester`, or **Customize → Plugins → … → Remove**). `/emailqa:start` can copy old project folders into the new workspace, including the client's Klaviyo account and the images already uploaded to it.

## Workspace

The workspace is the folder you open Claude in (desktop app: pick the folder before the first message). If you open Claude in your home folder, EmailQA uses `Email Projects` in the home folder instead.

```
<your folder>/
  workspace.json                 workspace settings ([TEST] prefix)
  library/                       shared: starter MJML, known noise, team lessons
  clients/
    acme/
      client.json                Figma files, Litmus folder address, the client's Klaviyo account
      .cache/                    caches, incl. which images are already in the client's Klaviyo
      brand/                     logos, colours, footer details
      emails/
        spring-sale/             one folder per email…
        black-friday/teaser/     …optionally grouped in subfolders
          email.json             record: Figma node, version, Klaviyo template, images, test values, tests
          email.mjml             source
          design/figma.png       the design reference
          images/                exported images (2x)
          build/email.html       compiled email
          qa/v3/                 Klaviyo render and Litmus screenshots per version
          handoff/v3/            for the client: images/ to upload, then <name>-final.html
```

## Daily use

Talk to Claude in plain language, or type the slash command. The plugin's skills handle the steps:

| Say | What happens |
|---|---|
| `/emailqa:start` | set up, or pick a new or existing client |
| "Build the selected Figma frame for Acme" | build-email: MJML, pre-checks, 600px / 375px / dark preview |
| "Make the headline smaller" | build-email: edit, recompile, re-check |
| "Test it in Litmus" / "re-test after the fixes" | test-email: host images, publish `[TEST]` template, send to Litmus, review |
| "It's approved, hand it off to the client" / pasting the client's image links | handoff-email: images and final template into the client's Klaviyo |

One email at a time: build → local preview → Litmus → fix → re-test → sign off → hand off to the client's Klaviyo. A person then builds and sends the campaign in the client's Klaviyo.

**Test values.** When a design has no real links or address yet, fake ones are recorded per email. The pre-check keeps warning until they're replaced.

**Litmus folders.** Give a client its Litmus folder's test address (a `+code` variant of yours) and its tests land in that folder.

## Handing off to a client's Klaviyo (no client API key)

The email is tested with images in your test Klaviyo account. The client's final email must use images in the client's own account. The **handler** is whoever manages the client's Klaviyo.

Say "it's approved, hand it off to the client". With the client's Klaviyo logged in to Chrome, Claude does the steps below in a tab of its own:

1. **Check the account.** It reads the open account's public key and stops if it isn't the client's. The account is saved in `client.json`. When you add the client, `/emailqa:start` can record it.
2. **Pack.** It copies the email's images into `emails/<email>/handoff/v<N>/images/`, and refuses if the email changed after its last Litmus test. Images already uploaded to this client for earlier emails (the logo, social icons) are reused, not uploaded again.
3. **Upload, after your OK.** Content → Media & brand → Images → Upload images, with **Use originals** so Klaviyo doesn't compress them. It then reads each new image's link from the list. Klaviyo gives every image its own file name (`https://cdn.klaviyomail.com/company/<public key>/images/<id>.png`), so links are matched by content, not by name.
4. **Swap.** It downloads each link and matches it to an image, then writes `emails/<email>/handoff/v<N>/<name>-final.html`. It writes nothing unless every image matched, every link is from the client's account, no test-account link is left, and nothing but the image links changed.
5. **Import, after your OK.** Content → Templates → Email: saved → Create → Import email template, uploading the final file.

Without Chrome, the handler does steps 3 and 5 by hand. `UPLOAD-STEPS.txt` in the handoff folder lists the clicks, including how to get each link: ⋮ → Preview opens the image in a new tab, and that tab's address is the link. The handler pastes the links into the chat, in any order.

Claude never logs in for you, types passwords or sends campaigns. A person builds and sends the campaign.

For a client's first email, send one test from the client's account to your Litmus address. Sending domain, physical address, unsubscribe headers and any Klaviyo badge come from the client's account, not from the HTML.

## Browser guard for Klaviyo

In a client's Klaviyo, Claude works through your logged-in browser, so it has that login's permissions. When Claude is opened in the workspace folder, a guard built into the plugin (a hook that runs before every browser call) fences this in:

- **Pages:** Claude's browser can open only the Klaviyo pages the handoff uses: sign-in, Settings → API keys, Media & brand → Images, Templates → Email: saved, and the template editor. Campaigns, flows, lists, profiles, billing and other settings are blocked.
- **Scripts:** browser scripts may only read pages. Scripts that click, navigate, submit, change form values or send non-GET requests are blocked, on any site.

The guard can't see where a mouse click on an allowed page leads. Those clicks follow the skill's rules: ask before every upload and import, never send. For a lock Klaviyo itself enforces, have the handler use a Klaviyo user role that can't send campaigns, such as Content Creator. Outside the workspace folder the guard does nothing, so open Claude in the workspace folder for handoffs.

## Keys and settings

| What | Where it's stored | How to change it |
|---|---|---|
| Klaviyo test-account key | Your system's secure credential store, through the plugin settings | `/plugin configure emailqa@email-template-tester` |
| Litmus test address | Plugin settings (not secret) | `/plugin configure emailqa@email-template-tester` |
| The client's Klaviyo account (name and public key, not secret) | `client.json` in the client's folder | handoff-email skill, or `set_client_klaviyo_account` |

**Change or revoke a key:** delete it in Klaviyo, create a new one with the same permissions (manual install, step 1), and enter it with `/plugin configure` in a terminal Claude session.

The client's own Klaviyo never gets an API key from you. Only the test account has one.

## Safety

The Klaviyo test-account connection **can**: read images and templates; upload images from an email folder; create and update `[TEST] …` templates; render previews; send test emails only to your Litmus address and its `+folder` variants.

It **can't**: delete anything, send campaigns, email customers, touch lists, profiles, flows or events, edit templates without the test prefix, or read files outside the workspace.

The client's Klaviyo is reached only by the handoff, through your logged-in browser, with your OK for each upload and import, and fenced by the browser guard above.

Designs are only read from Figma files listed for that client. Every tool works inside one client's folder.

## Limits

- Klaviyo test sends: about 100 per day per account, 15 per minute. Templates: 1,000 per account.
- Litmus previews: set by the plan.
- Figma: up to 10 Claude sessions can use Figma at once on one computer. Run the Desktop Bridge plugin in the file you're working on.

## Troubleshooting

- **EmailQA tools don't appear:** Node is missing or not on PATH (Windows: install, then quit and reopen Claude), or two copies of the plugin are installed. Run `/emailqa:start`.
- **Figma isn't connected:** run the Desktop Bridge plugin in the design file (right-click → Plugins → Development → Figma Desktop Bridge).
- **"No Klaviyo key set":** add it in the plugin settings, then start a new session.
- **"Blocked by the EmailQA Klaviyo guard":** the handoff tried to open a Klaviyo page outside the list above. Open that page yourself if you need it.

## Developing

The installed plugin needs no `npm install`: the servers are bundled into `plugins/emailqa/dist/`. The browser guard (`plugins/emailqa/scripts/klaviyo-guard.mjs`) has no dependencies and is not bundled.

```bash
cd plugins/emailqa/build
npm install            # build tools only
npm run build          # src/ → dist/ (commit dist/)
npm test               # smoke test of the bundled servers; add -- --figma-install to include the Figma server
claude plugin validate ..
```

Bump the version in `plugins/emailqa/.claude-plugin/plugin.json`, `plugins/emailqa/src/lib/common.mjs` and `.claude-plugin/marketplace.json` for every release, or installed copies won't update. See [docs/PLAN.md](docs/PLAN.md) for the design and [docs/windows-test.md](docs/windows-test.md) for the Windows checklist.
