# MJML house rules

Learned from real Litmus runs. Follow all of them unless the user says otherwise.

## Document

- `<mjml lang="en">`, an `mj-title`, and an `mj-preview` of 90 to 130 characters written from the email's content. Litmus flags preview text under 90 characters. Short preview text also runs on into the first alt text in the inbox.
- `mj-body width="600px"` with the page background color.
- `<mj-breakpoint width="480px" />`. Columns stack on mobile.
- Inset content bands (a colored band narrower than the body): put the sections inside `mj-wrapper` with side padding and give each section its own background.
- Keep the compiled HTML under 90 KB. Gmail clips at about 102 KB, and Klaviyo's link tracking adds bytes.

## Type and color

- Load web fonts with `mj-font` (Google Fonts) and always give web-safe fallbacks, for example `'Josefin Sans', Arial, Helvetica, sans-serif` and `'Playfair Display', Georgia, 'Times New Roman', serif`. Outlook and Gmail usually show the fallback.
- Use 6-digit hex colors only.
- Set font sizes and line heights in px. Mobile overrides go in `mj-style` media queries targeting a `css-class`, for example `.h1 div { font-size: 40px !important; }`.
- Small text: after the scaling in build-email step 3, round font sizes to whole px. Text that comes out below 10px becomes 10px. List each change in the report. This is a house choice, so that every build makes the same one, and the user can change it.
- The main headline is a real `<h1>` inside `mj-text`, with explicit inline styles (`margin:0; font-family:…; font-size:…; line-height:…; font-weight:…; color:…`), not `inherit`, because Outlook ignores `inherit`. Add the mobile override for `.h1 h1` too.

## Images

- Export at 2× the display width and set the display `width` explicitly.
- Every `<img>` has `alt`. Use descriptive alt for content images, and `alt=""` only for decorative icons next to their own text label.
- No SVG or WebP.
- Images must be hosted at absolute https URLs before any Klaviyo or Litmus test.

## Buttons

- Use `mj-button`, never an image of a button.
- A standalone button is at least 44px tall: `inner-padding` plus `line-height`, for example `inner-padding="10px 24px"` with `line-height="24px"`. 44px is the WCAG target size at level AAA (2.5.5).
- A button or pill inside a thin band from the design: keep the band height from the design. Keep the pill at least 24px tall, the WCAG 2.2 minimum at level AA (2.5.8). Do not grow the band to reach 44px. Say the pill height in the report.
- `mj-button` puts `padding="10px 25px"` around the button by default. In a narrow column, this padding narrows the button and a short label wraps. Set `padding="0"` on the button, and let the section or column own the gap.
- Do not give `mj-button` a fixed width in px that is wider than the mobile column. At 375px, a 420px button runs off the screen. Use `width="100%"` in a padded column, or leave the width out.
- Rounded corners become square in Outlook 2016 to 2021 (Word engine). Accept this. If the user asks for round corners there, build a VML button.

## Icon + text rows (for example date, time, location)

Use `mj-text` containing a `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`, not `mj-table`. `mj-table` does not mark tables as presentation-only, and Litmus flags that.

The icon cell must set `line-height` equal to the icon height, or Outlook 2016 to 2021 crops the image:

```html
<td width="36" style="width:36px;line-height:36px;font-size:0;mso-line-height-rule:exactly;vertical-align:middle;">
  <img src="…" width="36" height="36" alt="" style="display:block;border:0;" />
</td>
<td style="padding-left:12px;vertical-align:middle;font-family:…;font-size:14px;line-height:16px;color:…;">…</td>
```

Repeat the font family inline on text cells. Outlook does not inherit fonts into tables.

## Side by side

- An icon next to its text: the presentation table above.
- Columns that stay side by side on mobile, for example two small buttons: put the `mj-column` elements inside `mj-group`. An `mj-group` does not stack.
- Columns that stack on mobile, for example cards: plain `mj-column` elements, as in "Mobile" below.

```xml
<mj-section padding="16px 24px">
  <mj-group>
    <mj-column width="50%"><mj-button href="…" padding="0 6px 0 0" width="100%">Left</mj-button></mj-column>
    <mj-column width="50%"><mj-button href="…" padding="0 0 0 6px" width="100%">Right</mj-button></mj-column>
  </mj-group>
</mj-section>
```

## Spacing

Give each gap exactly one owner. Do not stack section padding and column padding for the same gap, or it doubles. For a grid of items, let each item carry its bottom gap and give the last row's section the remaining bottom padding.

## Mobile

- Columns that stack on mobile (cards, features): centre everything inside each card on mobile, not just the card box. A left-aligned box with centred text looks indented. Use a `css-class` on the section and a media query, as in `library/mjml-starter.mjml` (`.card-stack`).
- Check the 375px view in `preview_email` before any Litmus test.

## Text that breaks badly

- Hyphenated words (to-do, e-mail, check-in) can split across lines in fallback fonts (Arial in Gmail and the new Outlook). Wrap them in `<span class="nowrap">` with `.nowrap { white-space: nowrap; }`.
- iOS turns addresses, dates, times and phone numbers into blue underlined links. Add the `a[x-apple-data-detectors]` rule from the starter so they keep the design's colour, and give footer links an explicit colour.

## Contrast

- Body and footer text need at least 4.5:1 contrast with their background (3:1 for text 24px and up, or 18.66px bold). Light-grey footers on off-white often fail. `precheck_email` checks this.
- If a colour from the design fails, keep it. List it in the report for the designer, with the nearest passing text colour that `precheck_email` gives. A darker text colour can fail the Gmail App Android dark frame, and the suggestion says whether it stays readable there.

## Dark mode

Read `library/client-behavior.md` before you style colours, logos or dark areas. It says what each email client does in dark mode, with sources. The rules below follow from it. Add a fix marked "Not tested by us" as a Litmus variant next to the plain version. Do not make it the only change.

- Give `mj-body` and every `mj-section` a background colour. Apple Mail shows its dark window behind an area without one, and dark text disappears there.
- By default, leave out dark styles and the `color-scheme` meta tags. Without the meta tags, Apple Mail shows the light design unchanged. With the meta tags and no dark styles, Apple Mail inverts some colours. When the design has a dark version, or the user asks for one, add the dark styles below.
- Very dark text on a mid-tone coloured band fails in Gmail App Android. Gmail lightens the text and leaves the band, so the text turns pale. In black-friday, `#032d06` text on a `#f9ca0a` band turned pale mint. American Express puts the limit at about 20% grey (`#cccccc`). The yellow `#f9ca0a` has about the same luminance.
  - Do not repeat the band colour as `bgcolor` or as a small tiled background image. Both failed.
  - Test these as variants: the band copy as an image with the band colour and the copy in `alt`, or the Gmail `light only` tag below.
  - Say in the report that the band is at risk in Gmail App Android.
- Logos and icons on transparent PNGs: give the dark parts a thin light outline or glow, or put them on a solid plate. One file must work on white and on dark, because Gmail and Outlook on Windows ignore an image swap. `image_info` and `precheck_email` warn about these files.
- Never use `<picture>` for a light and dark image swap. Gmail replaces it with `<u></u>`.
- Apple Mail can flip pure white `#ffffff` and pure black `#000000`. If it flips one, use `#fffffe` or `#010101` instead.
- Check the dark frames in `preview_email`. They approximate Apple Mail, Gmail App Android and classic Outlook on Windows. They are not renders.

### Dark styles for Apple Mail, Outlook.com and Outlook mobile

Put the meta tags in an `mj-raw` inside `mj-head`, and the dark rules in `mj-style`. MJML writes a section background inline on the outer `div` and on its child `table`. A section `css-class` lands on that `div`. On `mj-text`, the class lands on the `td`, and the colour sits on the inner `div` or on an inline-styled `h1`. Gmail, Outlook on Windows and Yahoo ignore these rules.

```xml
<mj-head>
  <mj-raw>
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
  </mj-raw>
  <mj-style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) {
      .dm-bg, .dm-bg > table { background: #111111 !important; background-color: #111111 !important; }
      .dm-text div, .dm-text h1 { color: #f5f5f5 !important; }
    }
    [data-ogsb] .dm-bg, [data-ogsb] .dm-bg > table { background-color: #111111 !important; }
    [data-ogsc] .dm-text div, [data-ogsc] .dm-text h1 { color: #f5f5f5 !important; }
  </mj-style>
</mj-head>
<mj-section css-class="dm-bg" background-color="#ffffff" padding="24px 32px">
  <mj-column>
    <mj-text css-class="dm-text" color="#222222">Body copy</mj-text>
  </mj-column>
</mj-section>
```

Repeat `[data-ogsc]` or `[data-ogsb]` on every selector in a list. Outlook.com drops a rule with a bare selector in the list. We did not test the `[data-ogsc]` and `[data-ogsb]` rules.

### Gmail `light only` tag

When Gmail recolouring breaks a design without a dark version, try the `light only` tag below. Sources disagree on it (see `client-behavior.md`). It helps Google accounts only. Litmus Gmail previews can still show forced dark, so check it with a real send to a phone. The tag also stops Apple Mail dark styles. If the email has dark styles, keep the `:root` rule and leave out the `light dark` meta tags. The tag overrides the dark-mode choice of the reader, so say so in the report.

```xml
<mj-head>
  <mj-raw>
    <meta name="color-scheme" content="light only" />
  </mj-raw>
  <mj-style>
    :root { color-scheme: light dark; }
  </mj-style>
</mj-head>
```

### Dark areas in Outlook on Windows

Outlook 2021 and 365 on Windows turn a dark footer light grey and its light text dark grey. `[data-ogsc]` and `[data-ogsb]` do nothing there (failed in black-friday v2). Courier says that Microsoft names no supported way to stop it. Tuts+ documents two partial fixes. We did not test them, so add them as variants and check them on a real PC.

- Keep the background dark with a VML fill. Give the `mj-section` a `background-url` with a solid tile in the area colour, and the same `background-color`. MJML writes the Outlook `v:rect` and `v:fill`. Outlook does not recolour VML fills or images, but it still recolours the text on them. Make the tile at least 60 by 60 px, because Gmail inverts smaller tiles.
- Keep white text white with a class from a `gte mso 16` style block. `.ol-keep-white` is the gradient text trick. With `.ol-auto-white`, Outlook picks the text colour. It picks white with a body of `#555555` or lighter and a fill of `#333333` or darker. The class must be the only class on the element. Tuts+ says that the gradient trick is not reliable inside VML in Litmus.

```xml
<mj-head>
  <mj-raw>
    <!--[if gte mso 16]>
    <style>
      .ol-keep-white { mso-style-textfill-type:gradient; mso-style-textfill-fill-gradientfill-stoplist:"0 \#FFFFFF 0 100000\,100000 \#FFFFFF 0 100000"; color:#000000 !important; }
      .ol-auto-white { mso-color-alt:auto; }
    </style>
    <![endif]-->
  </mj-raw>
</mj-head>
<mj-section background-color="#1d1d1d" background-url="../images/footer-tile.png" background-repeat="repeat" padding="24px 32px">
  <mj-column>
    <mj-text>
      <p class="ol-keep-white" style="margin:0;font-family:Arial, Helvetica, sans-serif;font-size:12px;line-height:18px;color:#ffffff;">Footer text</p>
    </mj-text>
  </mj-column>
</mj-section>
```

### Near-black photo areas in Outlook 2021

White specks on near-black JPEG areas in Outlook 2021 have no documented cause. Do not repeat the fixes that failed in `lessons.md`: JPEG quality, colour sampling, a lossless PNG and the exact display width. `image_info` flags photos with many near-black pixels. To test the lead, add a `lift_blacks` copy as a variant next to the original.

## Freely positioned designs

Frames without auto-layout (header and hero text placed freely) are rebuilt as stacked sections: use the x/y positions from the layout outline to set padding and alignment. Overlapping layers become one flattened image (capture the parent, then `crop_image`). Say what was simplified.

## Klaviyo

- Personalization: `{{ first_name|default:"there" }}`.
- Footer must have an unsubscribe link, `<a href="{% unsubscribe_link %}">Unsubscribe</a>`, and a physical postal address: `{{ organization.full_address }}` or the sender's real address. Litmus fails the compliance check without an address.
- If the design has no footer or no address, add one small footer row in the design's smallest text style and colours: `{{ organization.full_address }}`, then `Unsubscribe` (`{% unsubscribe_link %}`) and `Manage preferences` (`{% manage_preferences_link %}`). Klaviyo advises a preferences link next to the unsubscribe link. This is not invented copy, because the law requires the address and the unsubscribe link. Say it in the report. The local preview shows the raw tags, and `render_template` in the test step fills them.
- Optional: `<a href="{% web_view_link %}">View in browser</a>`, `{{ organization.name }}`.
- Never put Klaviyo tags inside HTML comments. MJML keeps comments, and Klaviyo processes tags inside them.
- Klaviyo merges `<style>` blocks and turns font `<link>` tags into `@import`. This is fine.

## Things email cannot do

Absolute positioning, overlapping elements, rotated elements and blend modes. Simplify them (capture the parent and crop a flattened image, or drop decorative overlays) and tell the user what changed.

## Test values

Record fake links and sample addresses for tests with `set_test_values`. The pre-check then flags them until the real values are in. Do not hide them in comments.

## Links

- Text that names a website (for example ACMEOUTDOORS.COM) or reads like a link (Shop now, Learn more) is a link.
- Use the real URL from `links_in_design` in the `summarize_design` result, or from the user. If there is none, use a fake link of the form `https://example.com/?<what>`, for example `https://example.com/?shop`, and record it with `set_test_values`.
- The pre-check does not fetch example.com links or recorded test values. To change a recorded value, call `set_test_values` with `remove` and `values` in one call.
