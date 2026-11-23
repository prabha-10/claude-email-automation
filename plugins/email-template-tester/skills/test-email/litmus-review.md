# Reviewing a test in Litmus (via Chrome)

There's no Litmus API in this setup, so results are read in the user's logged-in Chrome with the Claude in Chrome tools. Work in your own tab and close it at the end.

## Don't touch

- **Run & add to list** (under "Recommended clients"): uses preview allowance.
- **Choose email clients**: changes the client list for everyone.
- **New version**, **Sync with ESP**, **Share** / public links, **Set status**, deleting emails.
- Anything in colleagues' emails.

## Find the test

1. Load the Chrome tools in one ToolSearch call, then `tabs_context_mcp`.
2. Open https://litmus.com/home. Use `find` for "links in the Recent emails list" containing the template name. Klaviyo test sends arrive as `[Preview] [TEST] <template name> Preview`. The newest is first; each send creates a separate Litmus email. The link is `/folders/<folder>/emails/<id>`; note the ID.

## Read the automated checks

- **Summary** (`/emails/<id>/summary`): the Send Readiness alert count. It covers accessibility and links; compliance is shown separately.
- **Checklist** (`/emails/<id>/checklist`): wait 5–6 seconds after loading, because the layout shifts while previews render. Click sidebar sections by `find` reference, not by coordinates.
  - **Compliance:** Physical Address, Unsubscribe Link, One-click Unsubscribe. The one-click headers come from Klaviyo at send time, not from the HTML.
  - **Links:** status per link. Klaviyo rewrites links through click tracking (`trk.klclick*.com`) and may add a Klaviyo branding link.
  - **Accessibility:** "WCAG issues" must be fixed. The "Best practices" tab holds optional suggestions.
  - **Loading Speed** and **Image Blocking** (the images-off view) are worth a glance.

Save one screenshot per section with `save_to_disk: true`.

## Look at key clients

Reload the checklist URL so the page is at the top, then wait. Click the **Filter email clients** box in the Previews header (not the one inside the Choose email clients dialog), type a client name, and click the first thumbnail to open its detail view. Scroll about 14 ticks to reach the middle of the email. Use `zoom` with `save_to_disk: true` on anything suspicious. The back arrow is at the top left.

Every round, check these against `emails/<slug>/design/figma.png`:

| Client | Why |
|---|---|
| Outlook 2021 | Word rendering engine; most layout bugs show here |
| Outlook for Windows | the new Outlook |
| Gmail (Chrome) | biggest webmail client |
| Apple Mail | biggest client overall; loads web fonts |
| iPhone (latest) | mobile stacking and font sizes |
| One dark mode, e.g. Outlook 2021 Dark or Gmail App Dark | color inversion |

Skim the rest of the grid as thumbnails for big failures only, such as missing images or a broken layout.

## Known patterns

- Outlook 2016–2021 crops images when the cell's line-height is smaller than the image (see the icon rule in build-email's mjml-rules.md).
- Rounded buttons become square in Outlook 2016–2021.
- Web fonts usually fall back to Georgia or Arial in Outlook and Gmail.
- iPhone underlines dates, times and addresses it detects.
- Klaviyo may add a large branding badge below the footer, depending on the account.

## Save the evidence

The screenshot tool returns a saved path. Copy each file into `emails/<slug>/qa/v<version>/` with a descriptive name, e.g. `outlook2021-details.jpg`. Close your tab when done.
