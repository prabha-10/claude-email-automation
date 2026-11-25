// Fix plans: before a fix goes into a Litmus round, the plan says what the cause is, where that comes from,
// what the fix is and how the next round proves it. Litmus rounds are the slow, costly part of testing, so a
// guess must not use one. A guess is allowed only as a test: several variants side by side (see variants.mjs).

import { allEntries, contained, similarity } from "./lessons.mjs";
import { summarizeVariants } from "./variants.mjs";

const NO_SOURCE = /^\s*(none|unknown|guess|n\/a|na|tbd|unsure|no source|not sure)\b/i;
const OUR_PROBLEM = /^\s*(OUR EMAIL|STILL BROKEN|NEW\b[^:]*\bour email)/i;

// Problems still open in the email after a recorded test. add_test can list them in `open`; if it does not,
// the findings that start with OUR EMAIL, STILL BROKEN or NEW (our email) count.
export function openProblems(test) {
  if (!test) return [];
  if (Array.isArray(test.open)) return test.open;
  return (test.findings || []).filter((f) => OUR_PROBLEM.test(f));
}

export function latestPlan(record) {
  const plans = record.plans || [];
  return plans[plans.length - 1] || null;
}

// The plan written after the last recorded test and not yet answered by a newer test.
export function pendingPlan(record) {
  const plan = latestPlan(record);
  if (!plan) return null;
  const last = (record.tests || [])[(record.tests || []).length - 1];
  return !last || new Date(plan.at) > new Date(last.at) ? plan : null;
}

export const variantIds = (variants) => (variants || []).map((v) => (/^\s*([A-Za-z0-9_-]+)\s*:/.exec(v) || [])[1]).filter(Boolean);

// Check the items of a new plan. Returns a list of problems; empty means the plan is acceptable.
export function checkPlanItems(items, lessonsText) {
  const errors = [];
  const failed = allEntries(lessonsText).filter((e) => e.kind === "failed");
  items.forEach((it, i) => {
    const n = `Plan item ${i + 1} ("${String(it.problem).slice(0, 50)}")`;
    const has = (s, min) => typeof s === "string" && s.trim().length >= min;
    if (!has(it.problem, 8)) errors.push(`${n}: say what the problem is, with the client app.`);
    if (!has(it.cause, 15)) errors.push(`${n}: the cause is missing or too short. Say why the client shows this, not only what it shows.`);
    if (!has(it.fix, 8)) errors.push(`${n}: the fix is missing.`);
    if (!has(it.proof, 12)) errors.push(`${n}: say how the next round proves the fix, for example which screenshot must show what.`);
    if (!has(it.source, 4)) errors.push(`${n}: say where the cause comes from: a lessons.md line, a URL, a screenshot path, or what you measured.`);
    const ids = variantIds(it.variants);
    if (it.variant_group) {
      if (ids.length < 2 || ids.length !== (it.variants || []).length) errors.push(`${n}: variants must be 2 or more lines like "A: control, unchanged" and "B: text as an image". One of them is the unchanged control.`);
      if (new Set(ids).size !== ids.length) errors.push(`${n}: variant ids must differ.`);
    } else if (NO_SOURCE.test(it.source || "")) {
      errors.push(`${n}: no source for the cause. Find one (find_lessons, the web, a measurement), or test the idea as variants (variant_group and variants).`);
    }
    if (it.variants?.length && !it.variant_group) errors.push(`${n}: variants need a variant_group name.`);
    // The same fix that already failed needs a reason why it will work this time.
    const tries = it.variants?.length ? it.variants : [it.fix];
    for (const t of tries) {
      for (const f of failed) {
        const sameProblem = similarity(`${it.problem} ${(it.clients || []).join(" ")}`, `${f.problem} ${f.clients}`) >= 0.25;
        if (sameProblem && contained(t, f.fix) >= 0.7 && !has(it.why_different, 15)) {
          errors.push(`${n}: "${String(t).slice(0, 60)}" already failed: ${f.line.replace(/^- /, "")}. Add why_different (what is different this time), or choose another fix.`);
          break;
        }
      }
    }
  });
  return errors;
}

// Refuse a Litmus send that has no reviewed round before it, or no plan for the problems that round found.
// `sends` is the number of earlier Litmus sends of this email. Returns an error message or null.
export function planGuard({ record, sends, mjml }) {
  if (sends === 0) return null;
  const tests = record.tests || [];
  if (tests.length < sends) {
    return `Litmus round ${sends} of this email has no recorded review. Review it and record it (update_email_record with add_test) before the next send, so the next round starts from what that one found.`;
  }
  const last = tests[tests.length - 1];
  const open = openProblems(last);
  if (!open.length) return null;
  const plan = pendingPlan(record);
  if (!plan) {
    return (
      `Round ${sends + 1} needs a fix plan. The last review (v${last.version}) left ${open.length} open problem(s): ${open.slice(0, 3).map((s) => `"${String(s).slice(0, 70)}"`).join("; ")}${open.length > 3 ? "; …" : ""}. ` +
      `Call find_lessons for each, then plan_fixes with the cause, its source, the fix and how the next round proves it. If the cause is not known, test two or more fixes as variants in this round.`
    );
  }
  const have = summarizeVariants(mjml || "");
  for (const it of plan.items) {
    if (!it.variant_group) continue;
    const g = have.groups.find((x) => x.group === it.variant_group);
    const ids = variantIds(it.variants);
    const missing = ids.filter((id) => !g?.ids.includes(id));
    if (!g || missing.length) {
      return `The plan promises variants "${it.variant_group}" (${ids.join(", ")}) but email.mjml ${g ? `lacks ${missing.join(", ")}` : "has no such group"}. Add the variant blocks, compile_email and upsert_template, then send.`;
    }
  }
  return null;
}

const RESULTS = ["worked", "failed", "inconclusive"];
const CONTROL = /^\s*[A-Za-z0-9_-]+\s*:\s*(control|unchanged|current|as is|no change)/i;

// A new test must say what happened to every fix in the plan written after the previous test.
export function checkPlanResults(plan, results) {
  if (!Array.isArray(results)) {
    return [`add_test needs plan_results: what happened to each of the ${plan.items.length} fix(es) in the last plan, as [{item, result, evidence}] (result is worked, failed or inconclusive).`];
  }
  const errors = [];
  plan.items.forEach((it, i) => {
    const name = `plan item ${i + 1} ("${String(it.problem).slice(0, 50)}")`;
    const r = results.find((x) => Number(x?.item) === i + 1);
    if (!r) return errors.push(`plan_results has no entry for ${name}.`);
    if (!RESULTS.includes(r.result)) errors.push(`${name}: result must be worked, failed or inconclusive.`);
    if (typeof r.evidence !== "string" || r.evidence.trim().length < 10) errors.push(`${name}: evidence is missing. Give the screenshot path and what it shows.`);
    if (it.variant_group) {
      for (const id of variantIds(it.variants)) {
        const v = (r.variants || []).find((x) => x?.id === id);
        if (!v || !RESULTS.includes(v.result)) errors.push(`${name}: say how variant ${id} did, in variants: [{id, result, evidence}].`);
      }
    }
  });
  return errors;
}

// Fix-log lines for lessons.md: one per fix, and one per variant that was not the control.
export function lessonEntries(plan, results, where) {
  const out = [];
  plan.items.forEach((it, i) => {
    const r = results.find((x) => Number(x?.item) === i + 1);
    const base = { clients: (it.clients || []).join(", "), problem: it.problem, cause: it.cause, where };
    if (it.variant_group) {
      for (const text of it.variants) {
        if (CONTROL.test(text)) continue;
        const id = variantIds([text])[0];
        const v = (r.variants || []).find((x) => x?.id === id);
        out.push({ ...base, kind: v.result, fix: text.replace(/^\s*[A-Za-z0-9_-]+\s*:\s*/, ""), evidence: v.evidence || r.evidence });
      }
    } else {
      out.push({ ...base, kind: r.result, fix: it.fix, evidence: r.evidence });
    }
  });
  return out;
}
