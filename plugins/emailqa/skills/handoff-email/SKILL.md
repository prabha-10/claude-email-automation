---
name: handoff-email
description: Hand a tested email over to a client's Klaviyo account without the client's API key. Uploads the email's images to the client's Klaviyo, checks the client's image links, swaps them in, and gives or imports the final HTML. Claude works in the handler's logged-in Chrome, or the handler does the steps by hand. Triggers: the user says an email is final, approved or signed off, or asks to pack images or prepare an email for the client. Another trigger is a paste of image links from a client's Klaviyo.
---

# Hand an email over to the client's Klaviyo

We built and tested the email with images hosted in our test Klaviyo account. The client's final email must use images hosted in the client's own Klaviyo account. We have no client API key, so the images move through the Klaviyo website:

```
pack images → upload to the client's Klaviyo → collect the image links → check and swap them in
→ final HTML → import into the client's Klaviyo
```

The handler is the person who manages the client's Klaviyo. It can be the user. The upload and the import happen in one of two ways:

- Browser: Claude does them in the handler's Chrome, which is logged in to the client's Klaviyo. If the Chrome tools are available, this is the default.
- By hand: the handler does them and pastes the links into the chat. If Chrome is not available or the handler prefers it, use this way.

Screens, labels and page snippets are in [klaviyo-screens.md](klaviyo-screens.md). Read it before any browser step.

Every EmailQA tool takes `client` and `email`, for example `spring-sale` or `black-friday/teaser`. If the user did not name the email, use the email tested last in this session. If that is not clear, call `list_clients` and `list_emails` and ask. The paths that the tools return are relative to the client folder. The `*_absolute` fields are full paths for browser uploads.

## Rules

- Never log in for the handler, type passwords, or complete "I'm not a robot" checks. If Klaviyo shows a sign-in page, ask the handler to sign in on that tab.
- Ask one question before you change the client's account, and wait for a yes. The question names the account, the files to upload (how many and their names), and the template name. One yes covers the upload and the import of this email. If the plan changes (other files, another account), ask again. Reading pages needs no approval.
- Never click Delete, Save in Settings, anything under Private API Keys, or Klaviyo's AI chat. Never send campaigns.
- The browser guard (a plugin hook) blocks every Klaviyo page except sign-in, API keys, Media & brand images, saved templates and the template editor. It also blocks browser scripts that click, go to another page, submit or change values. If Claude is opened in the EmailQA workspace folder, the guard is on. If it blocks a step, do not work around it: tell the user what you tried to do.
- Never swap image links by editing HTML by hand. Only `apply_client_image_links` writes the final HTML, because it checks each image and proves that nothing else changed.
- The final HTML is the tested HTML with only the image links changed. If anything else needs a change, fix it in the email, test it again (test-email skill), and hand it off again.

## 1. Make sure that it is ready

Read the email's record, `clients/<client>/emails/<email>/email.json`. `list_emails` shows its version and latest test. The latest entry in `tests` must be for the current `version`, and nothing must be left under "Our email". If not, finish the test-email skill first.

If `list_emails` shows test values left in the email, list them and stop. They must be replaced first. `precheck_email` catches example.com links but not wrong copy, so the question in step 4 asks the handler to make sure that the copy is final.

## 2. Make sure that the right client account is open

`list_clients` shows `client_klaviyo` (account name and public key) for each client.

Browser: open your own tab at `https://www.klaviyo.com/settings/account/api-keys`. Read the account with the snippet in [klaviyo-screens.md](klaviyo-screens.md).

- If `client_klaviyo` is null, note the account name and public key. The question in step 4 asks the handler to make sure that this is the client's account.
- If the open account's public key is different from `client_klaviyo`, stop. Ask the handler to switch to the client's account in the account menu (bottom of the left sidebar). Then read the account again.

By hand: if `client_klaviyo` is null, ask the handler for the client's account name and public key. They are in Settings → API keys → "Public API Key / site ID". Then call `set_client_klaviyo_account`. If the handler cannot give them now, carry on. The tools still make sure that all links come from one account.

## 3. Pack the images

Call `pack_images_for_client` with `client` and `email`. If the email was rebuilt after its last test, the tool refuses. Then test the email again first.

- `to_upload` lists the files to upload, all in `images_folder`. `images_folder_absolute` is the full path, and each file also has an `absolute_path`.
- `already_in_client_account` lists images uploaded for earlier emails, such as logos and social icons. The tool uses them again, so you do not upload them.
- If `to_upload` is empty, go to step 5 and call `apply_client_image_links` with no links.
- If `matches_tested_copy` shows `unreachable` for an image, say so. The test-account copy did not load, so the tool cannot prove that the local file is the tested one.
- If `hosted_elsewhere_left_as_is` lists images (for example social icons on another CDN), say that they stay as they are.

## 4. Ask once, then upload

Browser. Ask one question, for example: "In Klaviyo account <account name>, upload these N images (<file names>) and import '<template name>' as a new template? The copy must be final." For a null `client_klaviyo`, add: "This also records <account name> as the client's account."

On a yes:

1. If `client_klaviyo` was null, call `set_client_klaviyo_account` with `client`, the account name and the public key.
2. Open `https://www.klaviyo.com/brand-library/images` in your tab and click **Upload images**.
3. Click **Upload settings**, select **Use originals**, make sure that it is selected, then click **Back**. Do this every time, because the setting does not always stay.
4. Use `find` for the hidden file input inside the **Select media** dialog (it takes .png, .jpg and similar files). Call `file_upload` on it with the `absolute_path` of each file in `to_upload`. Keep each call under 10 MB in total. For more, split the files into several calls. The upload starts at once and the dialog closes by itself.
5. Wait a few seconds. Then read the newest rows with the "read the image list" snippet. Take the link of each row whose name is a packed file name without its extension.

If a file does not show after about 15 seconds, take a screenshot and tell the handler what you see. Do not upload again without asking.

By hand. Point the handler to `UPLOAD-STEPS.txt` in the handoff folder. It covers **Use originals** and how to get each link: ⋮ → Preview opens the image in a new tab, and the tab's address is the link. Then wait for the handler to paste the links.

## 5. Swap in the client's links

Call `apply_client_image_links` with `client`, `email` and every link from step 4 (the browser rows, or every https link in the handler's message). Order and file names do not matter, because the tool matches each link by its content. The tool adds the images it used again by itself.

If `final_html` is null, the tool wrote nothing. Explain what is missing in plain words:

- `no_link_found_for`: the image was not uploaded, or its link was not included. In the browser, look for it again in the image list. By hand, ask for the links of those files. If the handler says which link belongs to which file, call the tool again with every link plus `mapping`.
- `links_that_did_not_load`: the link is wrong or not public.
- `problems`: a link shows a different image than the file it was given for, or the links come from more than one account.
- `forgotten`: a remembered client link stopped working. Run `pack_images_for_client` again. That image is then packed for upload.
- An error that says the links are not from the client's account: the wrong account is open. Go back to step 2.

If an image says "re-compressed by Klaviyo", **Use originals** was not selected. The layout cannot change, but the sharpness can. Offer to upload those images again with **Use originals**, then call `apply_client_image_links` again. The EmailQA Klaviyo tools test only the email's own `[TEST]` template, so they cannot send the final file to Litmus.

## 6. Import the template

Template name: `<client name> / <email name>`, with no `[TEST]` prefix.

Browser. The yes from step 4 covers this import:

1. Open `https://www.klaviyo.com/templates/list` (Content → Templates, **Email: saved** tab). Click **Create** → **Import email template**.
2. Keep **Upload HTML file** selected. Fill in **Template name**.
3. Call `file_upload` on the dialog's `.html` file input with `final_html_absolute` from step 5. Leave the "triggered emails which are not marketing related" checkbox clear, and the zip input empty.
4. Click **Import template**. The dialog closes, and the template shows as a card in **Email: saved** under that name.
5. Look at the template, and read only. Open the card's ⋮ → **Preview** and note the **Template ID**. Then click **Edit template**, wait about 6 seconds, and run the "check an imported template's links" snippet. It must show 0 test-account links, and as many client links as the final file has. To leave, go to the templates list. Never type in the editor or press **Save**.

By hand. Give the handler the final file and the same steps.

## 7. Report

- The final file: `final_html`, that is `emails/<email>/handoff/v<N>/<name>-final.html` inside the client's folder.
- The client account it went to, and that only the image links changed.
- What you uploaded and which images you used again.
- In the browser path: the imported template's name and Template ID, and the result of the link check. A person builds and sends the campaign.

First email for this client? Suggest that the handler sends one test from the client's account to the Litmus test address. The account-level items are different from our test account: the sending domain, physical address, one-click unsubscribe headers, and any Klaviyo branding badge. Review them with the Compliance section of [litmus-review.md](../test-email/litmus-review.md).
