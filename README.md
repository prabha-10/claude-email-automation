# Email Template Tester for Claude Code

Turns a Figma email design into a tested Klaviyo template:

**Figma frame → MJML → pre-checks → Klaviyo `[TEST]` template → Litmus test → review and fix → handoff to the client's Klaviyo**

Testing happens in your own test Klaviyo and Litmus accounts. The client's Klaviyo needs no API key: Claude uploads the images and imports the final HTML through the Klaviyo website, in a Chrome where the client's account is logged in, with your OK for each change. Or a person does those steps by hand.

Claude builds and checks. People choose the design, approve it, and send the real campaign. The plugin can't send campaigns or email customers.

This repository is a Claude Code plugin marketplace containing one plugin, `email-template-tester`.

## What you need

- Claude Code (terminal, the desktop app's Code tab, or VS Code)
- Node.js (recent LTS) and git
- Figma Desktop
- Google Chrome with the Claude in Chrome extension, logged in to Litmus (and, for handoffs, to the client's Klaviyo)
- A Klaviyo test account and a Litmus account

The quick install below checks these for you and offers to install Node.js and git.

## Install

Once per computer. Never paste a key into a Claude chat: the Klaviyo key is typed into a hidden field.

### Quick install: paste a prompt (recommended)

1. Open a terminal and start Claude Code with `claude`. Do this in the terminal, not the desktop app, because the hidden key field (`/plugin configure`) is a terminal dialog.
2. Paste the prompt below into the Claude session, not into the shell itself.

Claude checks Node.js, git, Figma Desktop and Chrome, and offers to install what's missing (asking first). It then installs the plugin with one command, has you enter your Klaviyo key in the hidden field, and gives you the Figma bridge steps and the commands for daily work.

```text
Set up the "email-template-tester" Claude Code plugin on this computer, then guide me through first use. Work step by step and tell me what you're doing.

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
   claude plugin install email-template-tester --marketplace prabha-10/claude-email-automation --config litmus_test_address=<my address>
   Then confirm with: claude plugin details email-template-tester@email-template-tester

6. Klaviyo key. Tell me how to create it, then have me enter it:
   - In my TEST Klaviyo account: Settings → API keys → Create Private API Key → custom access: Images: Full access, Templates: Full access, everything else No access.
   - I type /plugin configure email-template-tester@email-template-tester in this session and paste the key into the hidden Klaviyo field.
   - Then I quit and reopen Claude Code so the plugin's servers start.

7. Before I restart, give me this guide to keep:

   Figma Desktop Bridge (first time only, after the restart)
   - The plugin's Figma server creates ~/.figma-console-mcp/plugin/manifest.json (Windows: %USERPROFILE%\.figma-console-mcp\plugin\manifest.json) the first time it runs, for example during /email-template-tester:check-setup.
   - In Figma Desktop: Plugins → Development → Import plugin from manifest… and choose that file.
   - Open the design file and run the Desktop Bridge plugin (Plugins → Development). Keep it running while Claude reads designs. If Claude later says the bridge is outdated, import it again.

   Daily flow, one folder per brand or client
   - Make the folder and start Claude in it:
     macOS: mkdir -p ~/"Email Projects/Acme" && cd ~/"Email Projects/Acme" && claude
     Windows PowerShell: mkdir "$HOME\Email Projects\Acme"; cd "$HOME\Email Projects\Acme"; claude
   - /email-template-tester:check-setup  → checks the install, Figma bridge, Klaviyo key, Litmus address and Litmus login in Chrome
   - /email-template-tester:new-project  → sets up the folder for the brand and records the client's Klaviyo account (have the client's Klaviyo logged in to Chrome)
   - Select the email frame in Figma, then /email-template-tester:build-email
   - /email-template-tester:test-email  → [TEST] template in my Klaviyo test account, test send to Litmus, review and fixes
   - /email-template-tester:handoff-email  → once approved: images and final template into the client's Klaviyo, asking me before each upload and import
   Plain language works too: "check the email setup", "build the selected frame", "test it in Litmus", "hand it off to the client".
```

After the restart, the plugin works in the terminal and in the desktop app's Code tab, in any folder. It's installed for your user, not for one folder. If the desktop app was open during setup, quit and reopen it.

### Manual install

The same steps by hand.

#### 1. Create your Klaviyo key

1. In your **test** Klaviyo account, open **Settings → API keys** and choose **Create Private API Key**.
2. Name it, for example `email-template-tester`, and choose custom access.
3. Set **Images: Full access** and **Templates: Full access**. Set everything else to **No access**.
4. Create it and copy the key. You'll enter it in step 3.

With only these permissions, the key can't reach lists, profiles, flows or campaigns, even outside this plugin.

#### 2. Get your Litmus test address

In Litmus, open **Settings → Account → Litmus address** and create one. It looks like `yourname@litmusemail.com`. Any email sent there becomes a Litmus test automatically, and it's where the plugin sends test emails.

#### 3. Install the plugin and add your key

In a terminal, one command adds the marketplace and installs the plugin:

```bash
claude plugin install email-template-tester --marketplace prabha-10/claude-email-automation --config litmus_test_address=yourname@litmusemail.com
```

Then start `claude` in the terminal and enter the Klaviyo key in the hidden field:

```
/plugin configure email-template-tester@email-template-tester
```

The key is stored in your system's secure credential store, not in any file. Restart Claude Code so the plugin's servers start.

Inside a Claude Code session you can instead type `/plugin marketplace add prabha-10/claude-email-automation` and then `/plugin install email-template-tester@email-template-tester`. That install asks for both settings itself.

The plugin brings its own Figma server. If you added a Figma server yourself before, leave it for now: the plugin notices it and tells you how to switch it off.

#### 4. Connect Figma (first time only)

In Figma Desktop, choose **Plugins → Development → Import plugin from manifest** and pick `~/.figma-console-mcp/plugin/manifest.json` (Windows: `%USERPROFILE%\.figma-console-mcp\plugin\manifest.json`). The file appears after the plugin's Figma server has run once, for example during the setup check in step 5. Then run the **Desktop Bridge** plugin in your design file. If Claude later says the bridge is outdated, import it again.

#### 5. Start a project (one folder per brand)

macOS:

```bash
mkdir -p ~/"Email Projects/Acme" && cd ~/"Email Projects/Acme" && claude
```

Windows (PowerShell):

```powershell
mkdir "$HOME\Email Projects\Acme"; cd "$HOME\Email Projects\Acme"; claude
```

Or open that folder in the desktop app's Code tab. Then:

1. **`/email-template-tester:check-setup`** (or "check the email setup"). It checks the install, then confirms Figma, your Klaviyo key (and where it comes from), your Litmus address, and your Litmus login.
2. **`/email-template-tester:new-project`** (or "set up this folder for Acme"). If whoever manages Acme's Klaviyo can log in to it in Chrome, Claude reads the account name and public key there and saves them. Every client image link is checked against that account later.

## What the plugin checks for you

Each time you open Claude in an email project folder, the plugin checks the setup. If something is wrong, it shows a warning when the session starts:

- a second Figma server that you added yourself, which would compete with the plugin's own
- plugin packages that failed to install
- no Klaviyo key, or a key that isn't a private key (`pk_…`)
- a per-brand key file that's missing, or that other users on the computer can read
- no Litmus test address, or a test address that isn't a Litmus address

It never changes your settings. It tells you the fix, and you run it. In other folders it stays quiet.

## Browser guard for Klaviyo

In a client's Klaviyo, Claude works through your logged-in browser, so it has that login's permissions. In email project folders, a guard built into the plugin (a hook that runs before every browser call) fences this in:

- **Pages:** Claude's browser can open only the Klaviyo pages the handoff uses: sign-in, Settings → API keys, Media & brand → Images, Templates → Email: saved, and the template editor. Campaigns, flows, lists, profiles, billing and other settings are blocked.
- **Scripts:** browser scripts may only read pages. Scripts that click, navigate, submit, change form values or send non-GET requests are blocked, on any site.

The guard can't see where a mouse click on an allowed page leads. Those clicks follow the skill's rules: ask before every upload and import, never send. For a lock Klaviyo itself enforces, have the handler use a Klaviyo user role that can't send campaigns, such as Content Creator. In other folders the guard does nothing.

## Keys and settings

| What | Where it's stored | How to change it |
|---|---|---|
| Default Klaviyo key | Your system's secure credential store, through the plugin settings | `/plugin configure email-template-tester@email-template-tester` |
| Per-brand Klaviyo key | `~/.email-template-tester/keys/<name>`, readable only by you | Rerun the command below |
| Litmus test address | Plugin settings (not secret) | `/plugin configure email-template-tester@email-template-tester` |

**Change or revoke a key:** delete it in Klaviyo, create a new one with the same permissions (manual install, step 1), and enter it with `/plugin configure` in a terminal Claude session.

**A brand with its own Klaviyo account:** give that brand its own key. In Terminal (zsh, the macOS default), run this with `acme` changed to a short name for the brand. It asks for the key without showing it:

```bash
mkdir -p ~/.email-template-tester/keys && chmod 700 ~/.email-template-tester ~/.email-template-tester/keys && read -s "K?Paste the Klaviyo private API key for acme: " && printf 'KLAVIYO_API_KEY=%s\n' "$K" > ~/.email-template-tester/keys/acme && chmod 600 ~/.email-template-tester/keys/acme; unset K; echo " saved"
```

When you set up that brand's folder, tell Claude it uses its own Klaviyo key called `acme`. For a project that already exists, set `"klaviyo": { "keyName": "acme" }` in its `pipeline.json`. That project then uses this key instead of your default one.

The plugin uses the first key it finds: the project's own key, then the plugin settings.

## One folder per brand or client

The plugin works in whichever folder you open Claude in. Each brand or client gets its own folder:

```
~/Email Projects/Acme/
  pipeline.json            brand settings and the client's Klaviyo account (created by "Set up this folder for …")
  .pipeline/               caches, incl. which images are already in the client's Klaviyo
  emails/
    spring-sale/
      email.json           record: Figma node, version, Klaviyo template, test results
      email.mjml           source
      design/figma.png     the design reference
      images/              exported images (2x)
      build/email.html     compiled email
      qa/v3/               renders and Litmus screenshots per version
      handoff/v3/          for the client: images/ to upload, then spring-sale-final.html
```

## Daily use

Talk to Claude in plain language, or type the slash command. The plugin's skills handle the steps:

| Say | Or type |
|---|---|
| "Check the email setup" | `/email-template-tester:check-setup` |
| "Set up this folder for Acme" | `/email-template-tester:new-project` |
| "Build the selected Figma frame" / "make the headline smaller" | `/email-template-tester:build-email` |
| "Test it in Litmus" / "re-test after the fixes" | `/email-template-tester:test-email` |
| "It's approved, hand it off to the client" / pasting the client's image links | `/email-template-tester:handoff-email` |

One email at a time: build → review in your browser → test in Litmus → fix → re-test → sign off → hand off to the client's Klaviyo. A person then builds and sends the campaign in the client's Klaviyo.

## Handing off to a client's Klaviyo (no client API key)

The email is tested with images in your test Klaviyo account. The client's final email must use images in the client's own account. The **handler** is whoever manages the client's Klaviyo.

Say "it's approved, hand it off to the client". With the client's Klaviyo logged in to Chrome, Claude does the steps below in a tab of its own:

1. **Check the account.** It reads the open account's public key and stops if it isn't the client's.
2. **Pack.** It copies the email's images into `emails/<slug>/handoff/v<N>/images/`, and refuses if the email changed after its last Litmus test. Images already uploaded to this client for earlier emails (the logo, social icons) are reused, not uploaded again.
3. **Upload, after your OK.** Content → Media & brand → Images → Upload images, with **Use originals** so Klaviyo doesn't compress them. It then reads each new image's link from the list. Klaviyo gives every image its own file name (`https://cdn.klaviyomail.com/company/<public key>/images/<id>.png`), so links are matched by content, not by name.
4. **Swap.** It downloads each link and matches it to an image, then writes `emails/<slug>/handoff/v<N>/<slug>-final.html`. It writes nothing unless every image matched, every link is from the client's account, no test-account link is left, and nothing but the image links changed.
5. **Import, after your OK.** Content → Templates → Email: saved → Create → Import email template, uploading the final file.

Without Chrome, the handler does steps 3 and 5 by hand. `UPLOAD-STEPS.txt` in the handoff folder lists the clicks, including how to get each link: ⋮ → Preview opens the image in a new tab, and that tab's address is the link. The handler pastes the links into the chat, in any order.

Claude never logs in for you, types passwords or sends campaigns. A person builds and sends the campaign.

For a client's first email, send one test from the client's account to your Litmus address. Sending domain, physical address, unsubscribe headers and any Klaviyo badge come from the client's account, not from the HTML.

## Limits to know

- Klaviyo test sends: about 100 per day per account, 15 per minute.
- Klaviyo API-created templates: 1,000 per account. Each new version updates the same `[TEST]` template.
- Litmus previews: set by your plan.
- Figma Desktop Bridge: one connection, so read designs from one Claude session at a time.

## What the Klaviyo connection can do

**Can:** read images and templates; upload images from the project folder (skipping duplicates); create and update `[TEST]` templates; render previews; send test emails only to your allowlisted Litmus address.

**Can't:** delete anything, send campaigns, email customers, touch lists, profiles, flows or events, edit templates without the test prefix, or upload files from outside the project folder.

## Developing the plugin

```bash
cd plugins/email-template-tester && npm install       # local runs don't auto-install dependencies
claude plugin validate .                              # validate the plugin
cd ../.. && claude --plugin-dir ./plugins/email-template-tester   # try it in one session without installing
```

Installed from git, Claude Code installs the dependencies itself from `package-lock.json`.
