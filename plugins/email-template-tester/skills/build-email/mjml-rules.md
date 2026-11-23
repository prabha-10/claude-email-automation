# MJML house rules

Learned from real Litmus runs. Follow all of them unless the user says otherwise.

## Document

- `<mjml lang="en">`, an `mj-title`, and an `mj-preview` of 40–130 characters written from the email's content.
- `mj-body width="600px"` with the page background color.
- `<mj-breakpoint width="480px" />`. Columns stack on mobile.
- Inset content bands (a colored band narrower than the body): put the sections inside `mj-wrapper` with side padding and give each section its own background.
- Keep the compiled HTML under 90 KB. Gmail clips at about 102 KB, and Klaviyo's link tracking adds bytes.

## Type and color

- Load web fonts with `mj-font` (Google Fonts) and always give web-safe fallbacks, e.g. `'Josefin Sans', Arial, Helvetica, sans-serif` and `'Playfair Display', Georgia, 'Times New Roman', serif`. Outlook and Gmail usually show the fallback.
- Use 6-digit hex colors only.
- Set font sizes and line heights in px. Mobile overrides go in `mj-style` media queries targeting a `css-class`, e.g. `.h1 div { font-size: 40px !important; }`.
- The main headline is a real `<h1>` inside `mj-text`, with explicit inline styles (`margin:0; font-family:…; font-size:…; line-height:…; font-weight:…; color:…`), not `inherit`, because Outlook ignores `inherit`. Add the mobile override for `.h1 h1` too.

## Images

- Export at 2× the display width and set the display `width` explicitly.
- Every `<img>` has `alt`. Use descriptive alt for content images, and `alt=""` only for decorative icons next to their own text label.
- No SVG or WebP.
- Images must be hosted at absolute https URLs before any Klaviyo or Litmus test.

## Buttons

- Use `mj-button`, never an image of a button.
- The tap target must be at least 44px tall: `inner-padding` plus `line-height`, e.g. `inner-padding="10px 24px"` with `line-height="24px"`.
- Rounded corners become square in Outlook 2016–2021 (Word engine). That's acceptable unless the user asks for a VML button.

## Icon + text rows (e.g. date, time, location)

Use `mj-text` containing a `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`, not `mj-table` (it doesn't mark tables as presentation-only, which Litmus flags).

The icon cell must set `line-height` equal to the icon height, or Outlook 2016–2021 crops the image:

```html
<td width="36" style="width:36px;line-height:36px;font-size:0;mso-line-height-rule:exactly;vertical-align:middle;">
  <img src="…" width="36" height="36" alt="" style="display:block;border:0;" />
</td>
<td style="padding-left:12px;vertical-align:middle;font-family:…;font-size:14px;line-height:16px;color:…;">…</td>
```

Repeat the font family inline on text cells; Outlook doesn't inherit fonts into tables.

## Spacing

Give each gap exactly one owner. Don't stack section padding and column padding for the same gap, or it doubles. For a grid of items, let each item carry its bottom gap and give the last row's section the remaining bottom padding.

## Klaviyo

- Personalization: `{{ first_name|default:"there" }}`.
- Footer must have an unsubscribe link, `<a href="{% unsubscribe_link %}">Unsubscribe</a>`, and a physical postal address: `{{ organization.full_address }}` or the sender's real address. Litmus fails the compliance check without an address.
- Optional: `<a href="{% web_view_link %}">View in browser</a>`, `{{ organization.name }}`.
- Never put Klaviyo tags inside HTML comments. MJML keeps comments, and Klaviyo processes tags inside them.
- Klaviyo merges `<style>` blocks and turns font `<link>` tags into `@import`; that's fine.

## Things email can't do

Absolute positioning, overlapping elements, and rotated elements. Simplify them (export a flattened image, or drop decorative overlays) and tell the user what changed.
