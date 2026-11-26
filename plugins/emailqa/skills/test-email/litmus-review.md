# Reviewing a test in Litmus (via Chrome)

The `emailqa:litmus-reviewer` agent does this review on Sonnet, and the test-email skill starts it. If the agent tool is not available, use this page.

This setup has no Litmus preview API. You read the results in the user's logged-in Chrome with the Claude in Chrome tools. Work in your own tab and close it at the end. Each browser call costs time, so use `browser_batch` for steps you can predict.

## Do not touch

- **Run & add to list** (under "Recommended clients"). It uses preview allowance.
- **Choose email clients**. It changes the client list for everyone.
- **New version**, **Sync with ESP**, **Share** or public links, **Set status**, and deleting emails.
- Anything in colleagues' emails or in other clients' folders.

## Steps

Follow the "Browser facts" and sections 1 to 4 in [the reviewer agent file](../../agents/litmus-reviewer.md). They hold the tested link forms, the anchors, the waits for client views that draw in tiles, and the read-only script that lists links. Two facts cost the most time in real reviews:

- The client-view link is `https://litmus.com/checklist/tests/<test id>#<anchor>`, opened on a fresh page load. The form `/folders/<folder>/emails/<id>/checklist#<anchor>` only scrolls the checklist page.
- A client view can stay blank for 20 to 80 seconds after it loads, and a wait can be at most 10 seconds.

In every round, compare these clients with `design/figma.png`:

| Client | Why |
|---|---|
| Outlook 2021 | Word rendering engine, where most layout bugs show |
| Gmail (Chrome) | the biggest webmail client |
| Apple Mail | the biggest client overall, and it loads web fonts |
| iPhone (latest) | mobile stacking, font sizes, and addresses that iOS turns into links |
| One dark mode, for example Gmail App Android dark or Outlook 2021 dark | color inversion and dark logos |

After a dark-mode warning in the pre-check, add the dark clients that the warning names. Look at the rest of the grid as thumbnails, for big failures only (missing images, broken layout).

## Known patterns

- If the line-height of a cell is smaller than its image, Outlook 2016 to 2021 crops the image (see the icon rule in mjml-rules.md).
- Rounded buttons become square in Outlook 2016 to 2021.
- Web fonts usually fall back to Georgia or Arial in Outlook and Gmail, and hyphenated words can wrap.
- iPhone underlines the dates, times and addresses that it finds.
- In dark mode, the dark parts of transparent PNGs disappear.

## Save the evidence

Copy all the screenshots into `qa/v<version>/` with one `import_file` call that lists them in `files`. At the end, close your tab.

## Fix plan items and variants

From round 2 on, check the client apps named in the fix plan first. Judge each plan item against its `proof` line. For an email with test variants, take one screenshot per variant with its label row in the picture. Judge each variant against the `proof` line: ok, bad or unclear. Report what you see. Do not name causes.
