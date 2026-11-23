---
name: test-email
description: Publish one email to Klaviyo as a [TEST] template, send it to the user's Litmus test address, review the Litmus results against the Figma design, and fix issues. Use when the user asks to test, QA, publish to Klaviyo, check in Litmus, or re-test an email after changes.
---

# Test an email in Klaviyo and Litmus

One email at a time, in an email project. Work on `emails/<slug>/`. If the user didn't name the email, call `list_emails` and ask.

## Rules

- Test sends go only to the allowlisted Litmus address. Never send campaigns or email anyone else.
- Each test send counts against Klaviyo's limit of about 100 per day per account (15 per minute), and each Litmus test uses preview allowance. Only send once the pre-checks pass.
- The same `[TEST]` template is updated every round; don't create a new one per version.

## 1. Pre-check

`compile_email`, then `precheck_email`. Stop and fix any failure, except "Every image URL is absolute https" when images are still local (step 2 fixes that).

## 2. Host the images

For every local image the MJML uses (`../images/...`):

- `upload_image` with `file_path: emails/<slug>/images/<file>`. Files already uploaded with this key come back with `reused: true`, so no duplicate is created.
- Replace the `src` in `email.mjml` with the returned URL.
- `update_email_record` with `patch: {"klaviyo": {"images": {"<file>": "<url>"}}}`.

Then `compile_email` and `precheck_email` again. Everything must pass now.

## 3. Publish the template

- Read `email.json` for the current `version`; the new version is that number + 1.
- `upsert_template` with `name: "<brand> / <slug>"` (brand from pipeline.json) and `html_path: emails/<slug>/build/email.html`. Pass `template_id` from `email.json` if it has one.
- `update_email_record` with `patch: {"version": <new>, "klaviyo": {"templateId": "<id>", "templateName": "<name>"}}` and a note.

## 4. Check the Klaviyo tags

`render_template` with sample data matching the tags (e.g. `{"first_name": "Paula"}`) and `save_to: emails/<slug>/qa/v<version>/klaviyo-render.html`. `unrendered_tags` must be empty. Klaviyo shows the unsubscribe link as `[unsubscribe_tag]` in renders; that's expected.

## 5. Send the test

`send_test_email` with the template ID and the same sample context. Litmus usually creates the test within 30 seconds.

## 6. Review in Litmus

Follow [litmus-review.md](litmus-review.md). Save screenshots into `emails/<slug>/qa/v<version>/`.

## 7. Record and report

`update_email_record` with `add_test`, for example:

```json
{"litmus_email_id": "12345678", "alerts": 1, "compliance": {"address": "passed", "unsubscribe_link": "passed", "one_click": "failed"}, "findings": ["..."], "screenshots": "emails/<slug>/qa/v3/"}
```

Report to the user in three groups:

1. **Our email:** layout or code issues we can fix, each with the client, what's wrong, the proposed fix, and the screenshot path.
2. **Klaviyo account side:** things the HTML can't change, such as the Klaviyo branding badge, one-click unsubscribe headers, and link-tracking domains.
3. **Optional or design choices:** e.g. Litmus's centered-text accessibility note.

## 8. Fix loop

On the user's go-ahead, edit `email.mjml` and repeat from step 1. Stop when the "Our email" group is empty, then remind the user to replace placeholders before a real send.

When the email is signed off, suggest the handoff-email skill. It moves the email into the client's Klaviyo account with the client's own image links. A person builds and sends the real campaign.
