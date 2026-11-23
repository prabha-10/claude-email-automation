---
name: handoff-email
description: Hand a tested email over to a client's Klaviyo account without the client's API key. Uploads the email's images to the client's Klaviyo (Claude in the handler's logged-in Chrome, or the handler by hand), checks the client's image links and swaps them in, and gives or imports the final HTML. Use when the user says an email is final, approved or signed off, asks to pack images or prepare an email for the client, or pastes image links from a client's Klaviyo.
---

# Hand an email over to the client's Klaviyo

The email was built and tested with images hosted in **our test Klaviyo account**. The client's final email must use images hosted in **the client's own Klaviyo account**. We have no client API key, so the images move through the Klaviyo website:

```
pack images → upload to the client's Klaviyo → collect the image links → check and swap them in
→ final HTML → import into the client's Klaviyo
```

The **handler** is whoever manages the client's Klaviyo. It may be the user. The upload and import happen in one of two ways:

- **Browser:** Claude does them in the handler's Chrome, which is logged in to the client's Klaviyo. This is the default when the Chrome tools are available.
- **By hand:** the handler does them and pastes the links into the chat. Use this when Chrome isn't available or the handler prefers it.

Screens, labels and page snippets are in [klaviyo-screens.md](klaviyo-screens.md). Read it before any browser step.

## Rules

- Never log in for the handler, type passwords, or complete "I'm not a robot" checks. If Klaviyo shows a sign-in page, ask the handler to sign in on that tab.
- **Ask before every change to the client's account.** Before uploading, name the files, how many there are, and the account name. Before importing, give the template name and the account name. Wait for a yes each time. Reading pages needs no approval.
- Never click Delete, Save in Settings, anything under Private API Keys, or Klaviyo's AI chat. Never send campaigns.
- The plugin's browser guard (a hook) blocks opening any Klaviyo page except sign-in, API keys, Media & brand images, saved templates and the template editor. It also blocks browser scripts that click, navigate, submit or change values. If it blocks a step, don't work around it: tell the user what you were trying to do.
- Never swap image links by editing HTML by hand. Only `apply_client_image_links` writes the final HTML, because it checks each image and proves nothing else changed.
- The final HTML is the tested HTML with only the image links changed. If anything else needs changing, fix it in the email, re-test (test-email skill), and hand off again.

## 1. Confirm it's ready

Read `emails/<slug>/email.json`. The latest entry in `tests` must be for the current `version`, and its findings must have nothing left under "Our email". If not, finish the test-email skill first.

Ask the user to confirm the placeholders are replaced (sample links, sample footer text). `precheck_email` catches example.com links, but not wrong copy.

## 2. Make sure the right client account is open

`pipeline.json` should have `clientKlaviyo` (account name and public key). The new-project skill records it.

**Browser:** open your own tab at `https://www.klaviyo.com/settings/account/api-keys` and read the account with the snippet in [klaviyo-screens.md](klaviyo-screens.md).

- If `clientKlaviyo` is missing, show the handler the account name and ask whether this is the client's account. On a yes, call `set_client_klaviyo_account`.
- If it's present but the open account's public key differs, stop. Ask the handler to switch to the client's account from the account menu (bottom of the left sidebar), then read it again.

**By hand:** if `clientKlaviyo` is missing, ask the handler for the client's account name and public key (Settings → API keys → "Public API Key / site ID"), then call `set_client_klaviyo_account`. If they can't now, carry on; the links are still checked for coming from a single account.

## 3. Pack the images

Call `pack_images_for_client`. It refuses if the email was rebuilt after its last test; re-test first if so.

- `to_upload` lists the files to upload, all in `images_folder`.
- `already_in_client_account` lists images uploaded for earlier emails, such as logos and social icons. They're reused, not uploaded again.
- If `to_upload` is empty, skip to step 5 and call `apply_client_image_links` with no links.
- If `matches_tested_copy` shows `unreachable` for an image, mention it. The test-account copy couldn't be loaded, so I can't confirm the local file is the one that was tested.
- If `hosted_elsewhere_left_as_is` lists images (for example social icons on another CDN), say they stay as they are.

## 4. Upload the images

**Browser.** Ask first: "Upload these N images to <account name>'s Klaviyo: <file names>?" On a yes:

1. Open `https://www.klaviyo.com/brand-library/images` in your tab and click **Upload images**.
2. Click **Upload settings**, select **Use originals**, check it is selected, then click **Back**. Do this every time, since the choice may not stick.
3. Use `find` for the hidden file input inside the **Select media** dialog (accepts .png, .jpg…). Call `file_upload` on it with the absolute paths of the files in `images_folder`. Keep each call under 10 MB in total; split into several calls if needed. The upload starts at once and the dialog closes by itself.
4. Wait a few seconds. Then read the newest rows with the "read the image list" snippet. Take the link of every row whose name is a packed file name without its extension.

If a file doesn't appear after about 15 seconds, take a screenshot, tell the handler what you see, and don't upload again without asking.

**By hand.** Point the handler to `UPLOAD-STEPS.txt` in the handoff folder. It covers **Use originals** and how to get each link: ⋮ → Preview opens the image in a new tab, whose address is the link. Then wait for them to paste the links.

## 5. Swap in the client's links

Call `apply_client_image_links` with every link from step 4 (the browser rows, or every https link in the handler's message). Order and file names don't matter: each link is matched by its content. Reused images are added automatically.

If `final_html` is null, nothing was written. Explain what's missing in plain words:

- `no_link_found_for`: the image wasn't uploaded, or its link wasn't included. In the browser, look for it again in the image list. By hand, ask for those files' links. If the handler says which link belongs to which file, call again with every link plus `mapping`.
- `links_that_did_not_load`: the link is wrong or not public.
- `problems`: a link is a different image than the file it was given for, or the links come from more than one account.
- `forgotten`: a remembered client link stopped working. Run `pack_images_for_client` again; that image is then packed for upload.
- An error about links not being from the client's account: the wrong account is open. Go back to step 2.

If any image says "re-compressed by Klaviyo", **Use originals** wasn't chosen. The layout can't change, but sharpness could. Offer to re-upload those images with **Use originals**, or run one Litmus check of the final HTML:

1. `upsert_template` with `name: "<brand> / <slug> (client final)"` and `html_path` set to the final file.
2. `send_test_email` with that template's ID.
3. Look at the images only, following [litmus-review.md](../test-email/litmus-review.md).

## 6. Import the template

Template name: `<brand> / <email name>`, with no `[TEST]` prefix.

**Browser.** Ask first: "Import '<template name>' into <account name>'s Klaviyo as a new template?" On a yes:

1. Open `https://www.klaviyo.com/templates/list` (Content → Templates, **Email: saved** tab). Click **Create** → **Import email template**.
2. Keep **Upload HTML file** selected. Fill **Template name**.
3. Call `file_upload` on the dialog's `.html` file input with the final HTML's absolute path. Leave the "triggered emails which are not marketing related" checkbox unchecked, and the zip input empty.
4. Click **Import template**. The dialog closes, and the template should appear as a card in **Email: saved** under that name.
5. Check it, reading only. Open the card's ⋮ → **Preview** and note the **Template ID**. Then **Edit template**, wait about 6 seconds, and run the "check an imported template's links" snippet. It must show 0 test-account links, and as many client links as the final file has. Leave by navigating to the templates list; never type in the editor or press **Save**.

**By hand.** Give the handler the final file and the same steps.

## 7. Report

- the final file: `emails/<slug>/handoff/v<N>/<slug>-final.html`
- the client account it went to, and that only the image links changed
- what was uploaded and what was reused
- in the browser path, the imported template's name and Template ID, and the link check. A person builds and sends the campaign.

**First email for this client?** Suggest the handler sends one test from the client's account to the Litmus test address. The account-level items differ from our test account: sending domain, physical address, one-click unsubscribe headers, and any Klaviyo branding badge. Review them with the Compliance section of [litmus-review.md](../test-email/litmus-review.md).
