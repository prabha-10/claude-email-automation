---
name: test-email
description: Publish emails from a client's folder to the agency's Klaviyo TEST account as [TEST] templates and send them to Litmus. Review the Litmus results against the Figma design and fix the issues. Use when the user asks to test, QA, publish to Klaviyo, check in Litmus, or re-test an email after changes.
---

# Test emails in Klaviyo and Litmus

Every tool takes `client` and `email`, for example `spring-sale` or `black-friday/teaser`. If the user did not name the email, use the one built or changed last in this session. If there is no such email and the client has more than one, ask.

## How to work

- Run the whole flow without stopping for questions. If the user must act (a login, the Figma bridge) or a tool refuses, stop. Otherwise, keep going.
- Each email gets 2 Litmus rounds. Round 1 finds every problem. Round 2 makes sure that the fixes work. `send_test_email` refuses a third round. If round 2 still shows a problem in "Our email" that the local preview cannot show, ask for a third round.
- Several emails: run steps 1 to 5 for each email. Then start one `emailqa:litmus-reviewer` agent per email in the same message. The reviews then run at the same time.

## Rules

- Testing runs on the agency's Klaviyo test account and Litmus account. The client's Klaviyo is touched only by the handoff-email skill.
- Test sends go only to the Litmus address or its `+folder` variants. Never send campaigns or email anyone else.
- Klaviyo allows about 100 test sends a day per account (15 a minute). Each Litmus send uses one set of previews, one per selected email client.
- The same `[TEST] <client> / <email>` template is updated every round.

## 1. Pre-check and local preview

`compile_email`, then `precheck_email`. Fix every failure except "Every image URL is absolute https" while images are still local (step 2 fixes that). Then `preview_email` and screenshot the compare page (600px, 375px, dark) with Claude in Chrome. Fix anything visible before you spend a Litmus round.

## 2. Host the images

`host_images`. One call uploads every local image that `email.mjml` uses, including CSS and VML background images. It reuses files that are already uploaded, re-uploads files that changed, and rewrites the links in `email.mjml`. If it returns `not_hosted`, fix those files and call it again.

Then `compile_email` and `precheck_email` again. Everything must pass now. Warnings about test values are fine for a test send.

## 3. Publish

`upsert_template`. It creates or updates the template, bumps the email's version and records it. If it says `unchanged`, nothing changed since the last publish: do not send again.

## 4. Check the Klaviyo tags

`render_template` with sample data that matches the tags, for example `{"first_name": "Paula"}`. `unrendered_tags` must be empty. Klaviyo shows the unsubscribe link as `[unsubscribe_tag]` in renders. That is expected.

## 5. Send to Litmus

`send_test_email` with the same sample context. If the client has a Litmus folder address, the email goes there. If not, it goes to the main Litmus address. The result gives `litmus_round` and `litmus_rounds_left`.

## 6. Review in Litmus

Start the `emailqa:litmus-reviewer` agent. It runs on Sonnet in a fresh context, which is faster than doing the review here. Give it: `client`, `email`, `version`, the template name, the client's Litmus folder (if known), the send time, and the path of `design/figma.png`. It saves screenshots into `qa/v<version>/` and returns the findings as JSON.

If the agent tool is not available, follow [litmus-review.md](litmus-review.md) yourself.

## 7. Record and report

`update_email_record` with `add_test`, for example:

```json
{"litmus_email_id": "12345678", "alerts": 1, "compliance": {"address": "passed", "unsubscribe_link": "passed", "one_click": "failed (account side)"}, "findings": ["..."], "screenshots": "qa/v2/"}
```

Sort the findings with the workspace's `library/known-noise.md` into three groups:

1. Our email: layout or code issues we can fix, each with the client app, the problem, the fix, and the screenshot path.
2. Klaviyo or account side: anything that matches known-noise (one-click unsubscribe on test sends, Klaviyo badge, tracking links, test-account sender or address).
3. Optional or design choices: for example, notes about centered text.

## 8. Fix loop

After round 1, fix every item in "Our email" at once, without asking. Check each fix in the local preview (step 1). Then do steps 2 to 7 once more for round 2. Show the user the report of each round as one short message, and keep going.

After round 2, stop. If "Our email" is empty, the email is ready. Remind the user about recorded test values (`list_emails` shows how many remain): replace them and call `set_test_values` with `clear: true` before a real send. Then suggest the handoff-email skill.

If a problem remains after round 2, report it with its screenshot and your best next fix. Do not send a third round unless the user asks for it. Then call `send_test_email` with `extra_round: true`.

If a result turned out to be account side and is not in `library/known-noise.md`, suggest adding it.
