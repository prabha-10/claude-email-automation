# Known noise in test results

Results that come from the Klaviyo test account or the way test sends work, not from our HTML. When a Litmus result matches one of these, report it under **Klaviyo / account side**, not under **Our email**, and don't try to fix it in the MJML.

| Litmus shows | Why | Group |
|---|---|---|
| Compliance: **One-click unsubscribe failed** | Klaviyo adds List-Unsubscribe headers to real sends, not to template test sends. | Account side |
| A **Klaviyo logo / "Powered by Klaviyo" badge** below the footer | Added by Klaviyo on some plans. | Account side |
| Links rewritten to `trk.klclick…` / `klclick` domains | Klaviyo click tracking. | Account side |
| Sender shows **via klaviyomail.com** or the test account's address | Test sends use the test account's sender. | Account side |
| Footer address is the **test account's** address | `{{ organization.full_address }}` fills from the sending account. In the client's account it shows theirs. | Account side |
| Unsubscribe link goes to a placeholder page | Expected in previews and test sends. | Account side |
| Accessibility "best practice": **centred text** | Optional; a design choice. | Optional |
| Square button corners in **Outlook 2016–2021** | Word rendering engine ignores border-radius. Acceptable unless a VML button is requested. | Optional |
| Web fonts fall back to Arial/Georgia in Outlook and Gmail | Expected; fallbacks are set. | Optional |

Add new entries here when a result turns out to be account-side. Keep the reason short.
