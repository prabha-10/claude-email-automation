---
name: new-project
description: Set up the current folder as an email project for one brand or client (writes pipeline.json and an emails/ folder, and records the client's Klaviyo account from the browser). Use when the user starts work for a new brand or client, or when another email-template-tester step reports there is no pipeline.json.
---

# Start an email project

One folder per brand or client. Everything for that brand lives in it: `pipeline.json` and one folder per email under `emails/`. The plugin is installed once and works in whichever folder Claude is opened in.

## Steps

1. **Confirm the folder.** Tell the user the current folder path and ask if this is where the brand's emails should live. If it's their home folder or a folder with unrelated files, suggest making a dedicated one (e.g. `~/Email Projects/<Brand>`) and reopening Claude there.
2. **Ask, in one message:**
   - Brand or client name.
   - The Figma file URL (optional).
   - Should this brand be **tested in a different Klaviyo account** from the test account in the plugin settings? (Usually no. This is about testing only; the client's own account is step 5.)
3. **If it's tested in its own Klaviyo account**, pick a short key name (e.g. `acme`) and give the user this command to run in Terminal (zsh, the macOS default). It asks for the key without showing it:
   ```bash
   mkdir -p ~/.email-template-tester/keys && chmod 700 ~/.email-template-tester ~/.email-template-tester/keys && read -s "K?Paste the Klaviyo private API key for acme: " && printf 'KLAVIYO_API_KEY=%s\n' "$K" > ~/.email-template-tester/keys/acme && chmod 600 ~/.email-template-tester/keys/acme; unset K; echo " saved"
   ```
   The key needs Images: Full access and Templates: Full access, everything else No access. Never ask the user to paste a key into the chat.
4. **Call `init_project`** with the brand, Figma URL and (only if step 3 applied) `klaviyo_key_name`.
5. **Record the client's Klaviyo account.** Finished emails go into the client's own Klaviyo account, by browser, without a client API key. Recording the account now means every image link can be checked against it later.
   - Ask whether the handler (whoever manages the client's Klaviyo) can log in to it in Chrome now.
   - If yes: load the Chrome tools, open your own tab at `https://www.klaviyo.com/settings/account/api-keys`, and wait a few seconds. On a sign-in page, ask the handler to sign in on that tab. Never type credentials.
   - Read the account with the snippet in [klaviyo-screens.md](../handoff-email/klaviyo-screens.md). Show the account name and ask: "Is this <brand>'s Klaviyo account?" If the login has several accounts, the handler switches from the account menu (bottom of the left sidebar), and you read it again.
   - On a yes, call `set_client_klaviyo_account`. Close your tab.
   - If not now: skip. The handoff-email skill asks again before the first handoff.
6. **Explain the layout** briefly:
   ```
   pipeline.json          brand settings
   emails/<email-name>/   one folder per email: design, images, email.mjml, build/, qa/, handoff/, email.json
   ```
7. **Next steps:** suggest the check-setup skill if this is the first project on this computer, then the build-email skill with a Figma frame selected.

If `init_project` reports the folder is already a project, show its settings instead. If it has no `clientKlaviyo`, offer step 5; otherwise stop.
