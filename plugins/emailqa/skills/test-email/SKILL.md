---
name: test-email
description: Publish emails from a client's folder to the agency's Klaviyo TEST account as [TEST] templates and send them to Litmus. Review the Litmus results against the Figma design. Find the cause of each problem and plan the fix. When the cause is not known, test several fixes side by side. Use when the user asks to test, QA, publish to Klaviyo, check in Litmus, or re-test an email after changes.
---

# Test emails in Klaviyo and Litmus

Every tool takes `client` and `email`, for example `spring-sale` or `black-friday/teaser`. If the user did not name the email, use the one built or changed last in this session. If there is no such email and the client has more than one, ask.

## How to work

- Run the whole flow without stopping for questions. If the user must act (a login, the Figma bridge) or a tool refuses, stop. Otherwise, keep going.
- A Litmus round is slow and costs credits, and a guess does not teach anything. Find the cause of a problem before you change the email. The plan step (step 8) makes you do this: `send_test_email` refuses a second round without a fix plan.
- Each email gets 2 Litmus rounds. Round 1 finds every problem. Round 2 tests the fixes. After `resolve_variants`, one more round is allowed to make sure that the result works. `send_test_email` refuses more unless the user asks for another round.
- Several emails: in steps 1 and 2, call `check_emails` once for all the emails, in place of `compile_email` and `precheck_email` for each email. Run the other steps up to step 5 for each email. Then start one `emailqa:litmus-reviewer` agent per email in the same message. The reviews then run at the same time.

## Rules

- Testing runs on the agency's Klaviyo test account and Litmus account. The client's Klaviyo is touched only by the handoff-email skill.
- Test sends go only to the Litmus address or its `+folder` variants. Never send campaigns or email anyone else.
- Klaviyo allows about 100 test sends a day per account (15 a minute). Each Litmus send uses one set of previews, one per selected email client.
- The same `[TEST] <client> / <email>` template is updated every round.

## 1. Pre-check and local preview

`compile_email`, then `precheck_email`. Fix every failure except "Every image URL is absolute https" while images are still local (step 2 fixes that). Then `preview_email` and screenshot the compare page with the browser. It shows 600px, 375px and one dark frame each for Apple Mail, Gmail App Android and classic Outlook on Windows. Fix anything visible before you spend a Litmus round.

The dark frames copy the colour change of each client. They are approximations, not renders. They do not show Outlook-only code (VML, mso blocks) or the Word layout engine. `precheck_email` warns about text that loses contrast in the Gmail and Outlook frames. Treat those warnings as problems to fix or to test as variants in round 1. Litmus stays the proof.

## 2. Host the images

`host_images`. One call uploads every local image that `email.mjml` uses, including CSS and VML background images. It reuses files that are already uploaded, re-uploads files that changed, and rewrites the links in `email.mjml`. If it returns `not_hosted`, fix those files and call it again.

Then `compile_email` and `precheck_email` again. Everything must pass now. Warnings about test values and test variants are fine for a test send. If the build report listed a design colour for the designer, its contrast failure is also fine for a test send. Litmus then shows the same failure, and the user decides.

## 3. Publish

`upsert_template`. It creates or updates the template, bumps the email's version and records it. If it says `unchanged`, nothing changed since the last publish: do not send again.

## 4. Check the Klaviyo tags

`render_template` with sample data that matches the tags, for example `{"first_name": "Paula"}`. `unrendered_tags` must be empty. Klaviyo shows the unsubscribe link as `[unsubscribe_tag]` in renders. That is expected.

## 5. Send to Litmus

`send_test_email` with the same sample context. If the client has a Litmus folder address, the email goes there. If not, it goes to the main Litmus address. The result gives `litmus_round` and `litmus_rounds_left`.

## 6. Review in Litmus

Start the `emailqa:litmus-reviewer` agent. It runs on Sonnet in a fresh context, which is faster than doing the review here. Give it: `client`, `email`, `version`, the template name, the client's Litmus folder (if known), the send time, and the path of `design/figma.png`. From round 2 on, also give it the items of the last fix plan: for each item, the client apps to check, the `proof` line, and the variant ids. It saves screenshots into `qa/v<version>/` and returns what it saw as JSON.

If the agent tool is not available, follow [litmus-review.md](litmus-review.md) yourself.

## 7. Record the round

Sort the findings with the workspace's `library/known-noise.md` into three groups:

1. Our email: layout or code issues we can fix, each with the client app, the problem and the screenshot path.
2. Klaviyo or account side: anything that matches known-noise (one-click unsubscribe on test sends, Klaviyo badge, tracking links, test-account sender or address).
3. Optional or design choices: for example, notes about centered text.

Then `update_email_record` with `add_test`:

```json
{"litmus_email_id": "12345678", "alerts": 1, "compliance": {"address": "passed", "unsubscribe_link": "passed", "one_click": "failed (account side)"}, "findings": ["..."], "open": ["Gmail App Dark: band text pale green"], "screenshots": "qa/v2/"}
```

`open` lists the problems in "Our email" that are still open after this round. If no problem is open, use an empty list.

If the last fix plan has items, `add_test` must also have `plan_results`. For each plan item, give the item number, `result` (worked, failed or inconclusive) and `evidence` (a screenshot path and what it shows). For an item with variants, add `variants` with the result of each variant. `update_email_record` refuses without them. It writes every result into `library/lessons.md`, so a failed fix is not tried again.

Show the user the report of the round as one short message, and keep going.

## 8. Diagnose, plan, fix

If "Our email" has no open problem, the email is ready. Remind the user about recorded test values (`list_emails` shows how many remain): replace them and call `set_test_values` with `clear: true` before a real send. Then suggest the handoff-email skill.

If a problem is open, do not edit yet. For each open problem:

1. Call `find_lessons` with the client app and the symptom, for example "Outlook 2021 dark white text". Read both lists. `matches` comes from our fix log: a fix with `[failed]` already failed, so do not repeat it unless you know what is different this time. `client_behavior` tells what that client does and which fixes a source documents.
2. If the lessons or the client behavior give a cause with a source, use it.
3. If they do not, search the web for the cause of that client app and symptom. With two or more unknown problems, start one general-purpose agent per problem on Sonnet in the same message. Tell each agent the client app, the symptom and what already failed. Tell it to search for at most 5 minutes. It returns the mechanism and two or three fixes that developers report, with a source URL for each. It also marks which claims a source states and which claims are guesses.
4. Decide the shape of the fix. If the cause has a source and one fix follows from it, plan one fix. If the cause is not known, or two or more fixes are possible, test them as variants (see below). For white specks on the near-black areas of a photo in Outlook 2021, `lift_blacks` makes a copy of the photo with its darkest pixels raised. Use the copy as a variant next to the original.
5. Call `plan_fixes`. For each problem, give the client apps, the cause, the source of the cause, the fix, and the `proof`: what the next round must show for the fix to count. The tool refuses a plan with no cause, no source or no proof, and refuses a fix that already failed.
6. Make the changes. Do steps 1 to 7 again.

If the cause stays unknown after the search and no fix is possible in code, do not send another round. Report the problem to the user with its screenshot, what was tried, and the options (for example text as an image, or a design change).

If the user asks for a round beyond the limit, call `send_test_email` with `extra_round: true`. It still needs a plan.

## Variants

Variants test two to four fixes for one problem in one Litmus round. In `email.mjml`, put each variant between two comments:

```
<!-- variant band A: control, unchanged -->
<!-- variant-label -->
<mj-section background-color="#ff00ff"><mj-column><mj-text>VARIANT band A: control</mj-text></mj-column></mj-section>
<!-- /variant-label -->
<mj-section>...the section as it is now...</mj-section>
<!-- /variant band A -->
```

- `band` is the group, one group per problem. `A` is the variant id. Variant A is the unchanged control.
- A variant is one or more whole `mj-section` blocks. Put the label row first, as its own section, so the reviewer sees the label in every screenshot.
- A change in `mj-head` (meta tags, styles) applies to every variant. Do not mix a head change with body variants, unless you want to see their combined effect.
- Use at most two groups and four variants per group in one round. The email gets long.
- The plan lists the group and the variant lines, for example `variant_group: "band"` and `variants: ["A: control, unchanged", "B: band text as an image"]`. If the blocks are not in `email.mjml`, `send_test_email` refuses.

After the review, record `plan_results`, then call `resolve_variants` with the variant that worked. It removes the other variants and the label rows. If none worked, keep the control and report the evidence to the user. Then run `compile_email`, `precheck_email`, `host_images`, `upsert_template` and `send_test_email`. This send is the extra round. A client gets only a version that was tested exactly as it is. `pack_images_for_client` refuses while test variants are still in `email.mjml`.

If a result turned out to be account side and is not in `library/known-noise.md`, suggest adding it.
