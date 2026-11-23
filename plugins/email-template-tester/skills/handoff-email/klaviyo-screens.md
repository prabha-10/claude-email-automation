# Klaviyo screens for the handoff

Mapped on 2026-11-23 in live Klaviyo accounts, in Chrome. That included a full rehearsal handoff into a second account: account check, upload, links, swap, import, and a re-run that reused the images. Klaviyo's help pages use some older labels. These are the labels the app actually shows. Find elements with `find` by these labels, not by coordinates.

In email project folders, the plugin's browser guard (`scripts/klaviyo-guard.mjs`) lets Claude's browser open only these Klaviyo pages: `/login`, `/settings/account/api-keys`, `/brand-library/images`, `/templates/list` and `/email-editor/<id>/edit`. Browser scripts may only read. Clicks and typing go through `find` and `computer`.

## Snippets (run with `javascript_tool` in your own tab)

**Read the open account** on `https://www.klaviyo.com/settings/account/api-keys`, after the page has loaded for a few seconds:

```js
(() => { const rows = [...document.querySelectorAll('table tr, [role="row"]')].map(r => [...r.children].map(c => c.innerText.trim())); const head = rows.findIndex(r => r.some(c => /^Public API Key$/i.test(c))); if (head < 0) return { found: false }; const key = rows[head].findIndex(c => /^Public API Key$/i.test(c)); const name = rows[head].findIndex(c => /^Company Name$/i.test(c)); const row = rows[head + 1] || []; return { found: true, accountName: row[name], publicKey: row[key] }; })()
```

**Read the image list**, newest first, on `https://www.klaviyo.com/brand-library/images`:

```js
[...document.querySelectorAll('table tbody tr')].slice(0, 40).map(tr => ({ name: tr.querySelector('td:nth-child(2)')?.innerText.trim(), link: tr.querySelector('img')?.src }))
```

**Check an imported template's links** in the template editor (`/email-editor/<template id>/edit`), after it has loaded for about 6 seconds. Put the test account's public key in `TEST` and the client's in `CLIENT`:

```js
(() => { const TEST = 'AbC123', CLIENT = 'XyZ789'; const texts = [document.body.innerText]; for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) texts.push(f.contentDocument.documentElement.outerHTML); } catch {} } const all = texts.join('\n'); return { testLinks: (all.match(new RegExp(`company/${TEST}/`, 'g')) || []).length, clientLinkUses: (all.match(new RegExp(`company/${CLIENT}/images/`, 'g')) || []).length }; })()
```

## Which account is open

- **Account menu:** bottom of the left sidebar. It shows the account (company) name. Accounts the login can switch to are listed there too (only one account was available when this was mapped).
- **Settings → General → API keys** (`/settings/account/api-keys`): the table "Public API Key / site ID" shows Company Name and a 6-character public key. Don't open, reveal or copy anything in "Private API Keys".
- **The public key is the account ID in every hosted image link** (verified):
  `https://cdn.klaviyomail.com/company/<public key>/images/<generated-id>.<ext>`
  Read it once per client and use it to check that every link belongs to that client.
- **Settings → General → Account** (`/settings/account/organization`): default sender name and email, company name, website, postal address. These fill `{{ organization.* }}` tags. Read only; never press Save.

## Image library

- **Content → Media & brand → Images** tab (`/brand-library/images`). The help pages call it "Images & brand".
- **Table columns:** Image (thumbnail and name), Size, Type, Update Date, and an Actions (⋮) button. It's sorted by Update Date, newest first, and paged (Prev / Next), so fresh uploads are on the first page. There's a "Search images" box.
- **Names:** Klaviyo generates its own file name for the link (a UUID). The name you uploaded with is kept only as the library name, shown without the extension in the account that was mapped.
- **Reading links:** each row's thumbnail `<img src>` is the hosted link itself, with no resize parameters. Read name and link per row with `javascript_tool`: `table tbody tr`, name in the second cell, link from `img.src`.
- **Row ⋮ menu:** Rename, Preview, Delete. There's no "copy link". Preview opens the image in a new tab whose address is the link. Never click Delete.

## Upload

- The **Upload images** button (top right) opens the **Select media** dialog, with tabs **Upload media** and **Import URL**.
- **Upload media:**
  - It has a hidden `input[type=file]` inside the dialog: multiple files, accepts .png .jpg .jpeg .gif .webp .mp4 .mpeg, 10 MB per file.
  - Fill it with `file_upload`. Don't click **Select media**, because it opens a native file picker.
  - Don't confuse it with the page's other file input. That one belongs to Klaviyo's AI chat, sits outside the dialog, and accepts .pdf/.txt/.md.
- **Upload settings** (button in the dialog) has three radio choices: **Compare** (the default, marked Recommended), **Use originals**, and **Use compressed**. Choose **Use originals**, then **Back**.
  - The choice doesn't carry over: a second account started on Compare again. Set it on every upload.
- **What happens after files are chosen (verified with a real upload):**
  - With **Use originals**, the upload starts at once. There's no confirm step, the dialog closes by itself, and the new image appears at the top of the list within a few seconds.
  - The hosted file was byte-identical to the uploaded one (same size and SHA-256).
  - The library name is the file name without its extension.
- **Import URL:** one image URL at a time, then **Import image**.

## Template import

- **Content → Templates**, tab **Email: saved**, then **Create** (top right) → **Import email template**. The Create menu also has New template and New email folder.
- **The dialog:**
  - Toggle between **Upload HTML file** and **Paste HTML** (radio group `htmlMethod`).
  - **Template name** (`name`).
  - An HTML file input (`.html`).
  - A checkbox: "Only check this box if this template will be used for triggered emails which are not marketing related". Leave it unchecked for campaigns.
  - An optional `.zip` input, "Upload additional files used in the template".
  - The **Import template** button.
- A note in the dialog reminds that marketing templates need an unsubscribe link.
- **After Import template (verified):**
  - The dialog closes and the page stays on **Email: saved**. The new template appears as a card marked HTML.
  - The template's HTML was kept intact. The editor source had exactly the client image links of the final file, and no test-account links.
- **Template card ⋮ menu:** Edit, Rename, Move, Export, Clone, Preview, Delete.
  - **Preview** opens a dialog with the rendered email, Created and Edited times, and the **Template ID**. Klaviyo tags show raw there.
  - **Edit template** in that dialog opens `/email-editor/<template id>/edit`: HTML source on the left, preview on the right.
  - To only look, read the page, then leave by navigating to `https://www.klaviyo.com/templates/list`. Never type in the editor or press **Save**.

## Don't touch

- Private API Keys.
- Delete, on images or templates.
- Any Save button in Settings.
- Create account.
- Klaviyo's AI chat (Composer) at the bottom of every page.
