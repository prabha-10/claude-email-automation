# Reviewing a test in Litmus (via Chrome)

The `emailqa:litmus-reviewer` agent does this review on Sonnet, and the test-email skill starts it. If the agent tool is not available, use this page.

This setup has no Litmus preview API. You read the results in the user's logged-in Chrome with the Claude in Chrome tools. Work in your own tab and close it at the end. Each browser call costs time, so use `browser_batch` for steps you can predict.

## Do not touch

- **Run & add to list** (under "Recommended clients"). It uses preview allowance.
- **Choose email clients**. It changes the client list for everyone.
- **New version**, **Sync with ESP**, **Share** or public links, **Set status**, and deleting emails.
- Anything in colleagues' emails or in other clients' folders.

## Find the test

1. Load the Chrome tools in one ToolSearch call, then call `tabs_context_mcp`.
2. Open the client's Litmus folder. If the client has no folder, open https://litmus.com/home.
3. Use `find` for links in the "Recent emails" list that contain the template name. Klaviyo test sends arrive as `[Preview] [TEST] <client> / <email> Preview`. The newest is first, and each send makes a separate Litmus email.
4. The link has the form `/folders/<folder>/emails/<id>`. Note the folder and the ID.

## Read the automated results

Always use the full folder form of the address, `https://litmus.com/folders/<folder>/emails/<id>/...`. The short form `/emails/<id>/...` opens the Litmus marketing site and shows a 404 page.

After each page load, wait 5 to 6 seconds, because the layout shifts while previews render. Click by `find` reference, not by coordinates. After each click, make sure that the section heading is the one you wanted, because a click can land on the next section.

To read every section in one call, use the `javascript_tool` snippet in the `emailqa:litmus-reviewer` agent file.

- `Summary` page (`/folders/<folder>/emails/<id>/summary`): the Send Readiness alert count. It covers accessibility and links. Compliance is separate.
- `Checklist` page (`/folders/<folder>/emails/<id>/checklist`):
  - Compliance: Physical Address, Unsubscribe Link, One-click Unsubscribe. On test sends, one-click is account side (see `library/known-noise.md`).
  - Links: the status of each link. Klaviyo rewrites links through click tracking.
  - Accessibility: you must fix the "WCAG issues". The "Best practices" tab holds optional suggestions.
  - Loading Speed and Image Blocking (the images-off view): look at them quickly.

Save one screenshot per section (`save_to_disk: true`). Then copy each with `import_file` into `qa/v<version>/` with a clear name, for example `checklist-compliance.jpg`.

## Look at key clients

Use direct links first. Each client preview has its own anchor on the `Checklist` page, for example `https://litmus.com/folders/<folder>/emails/<id>/checklist#iphone17`. These are the known anchors. After a client version changes, Litmus can rename its anchor.

| Client | Anchor |
|---|---|
| Outlook 2021 | `#ol2021` |
| Gmail (Chrome) | `#chromegmailnew` |
| Apple Mail | `#applemail26` |
| iPhone (latest) | `#iphone17` |
| Gmail App dark | `#android15gmailappdark` |

Open the address, wait, and make sure that the detail view shows the expected client name. If an anchor opens the wrong client, use the fallback:

1. Reload the `Checklist` page.
2. Click the "Filter email clients" box in the Previews header, not the box inside "Choose email clients".
3. Type the client name and click the first thumbnail.

Do not use the next-client arrow, because it can skip clients. If you find a new anchor, put it in your report, so the table can be updated.

In the detail view, scroll about 14 ticks to reach the middle of the email. Use `zoom` with `save_to_disk: true` on anything that looks wrong.

In every round, compare these clients with `design/figma.png`:

| Client | Why |
|---|---|
| Outlook 2021 | Word rendering engine, where most layout bugs show |
| Outlook for Windows | the new Outlook |
| Gmail (Chrome) | the biggest webmail client |
| Apple Mail | the biggest client overall, and it loads web fonts |
| iPhone (latest) | mobile stacking, font sizes, and addresses that iOS turns into links |
| One dark mode, for example Gmail App dark or Outlook 2021 dark | color inversion and dark logos |

Look at the rest of the grid as thumbnails, for big failures only (missing images, broken layout).

## Known patterns

- If the line-height of a cell is smaller than its image, Outlook 2016 to 2021 crops the image (see the icon rule in mjml-rules.md).
- Rounded buttons become square in Outlook 2016 to 2021.
- Web fonts usually fall back to Georgia or Arial in Outlook and Gmail, and hyphenated words can wrap.
- iPhone underlines the dates, times and addresses that it finds.
- In dark mode, the dark parts of transparent PNGs disappear.

## Save the evidence

Screenshot tools return a saved path, usually in a temporary folder. Copy each screenshot into `qa/v<version>/` with `import_file`. At the end, close your tab.
