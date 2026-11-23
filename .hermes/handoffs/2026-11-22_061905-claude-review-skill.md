---
id: claude-review-skill-handoff
parent: pdf-to-markdown-donation-plan
# Single-file handoff; parent identifies the concrete example, not a dependency.
description: Evidence and design requirements for a reusable Claude Code review-and-reconcile skill.
---

# Handoff: build a `claude-review` skill

## Mission for future Hermes

Create and test a **reusable** skill for reviewing a plan (and optionally a code diff) with the local Claude Code CLI. The skill must perform the full loop by default when the user asks for a Claude review **and authorizes edits**: inspect target and repo → one bounded, read-only Claude review → parse and validate structured output → independently check findings → edit the requested target to resolve supported findings → verify coverage and the edited artifact → report remaining decisions/blockers. The external Claude process is a reviewer, never the author of the plan changes unless separately requested. Do not treat a CLI exit code or Claude's self-report as proof of a valid review.

This is a handoff, **not the skill itself**. Follow `superpowers:writing-skills` (including a failing baseline pressure scenario and post-skill test), and use `skill_manage` for creation rather than writing directly into the skills directory. Check whether `ai-coding-agents` already covers some mechanics; cross-reference it, do not duplicate its generic delegation guidance. Trigger description suggestion: “Use when asking Claude Code to review a plan or code change and reconcile actionable findings into the requested artifact.”

## Concrete example and verified handles

- Repo/worktree: `/root/repo/pdf_to_markdown`, branch `main` at review time, with `.hermes/` untracked. Its site is `pdf_to_markdown/` (React/CRA + Node proxy), Cloudflare Pages public preview; this is only example context, not a reusable skill assumption.
- Initial plan: `/root/repo/pdf_to_markdown/.hermes/plans/2026-11-22_055625-donation-modal-stripe.md`. User requested Stripe-hosted one-time support modal and exact German copy (including typo `uch`), English for non-German locales, no PayPal.
- Claude's normalized review: `/root/repo/pdf_to_markdown/.hermes/plans/2026-11-22_055625-donation-modal-stripe-review.json`. It has `verdict: needs_revision` and 14 findings `F1`–`F14` with severity/location/issue/recommended_change. The raw Claude CLI JSON wrapper is a separate `.raw.json` file; it is *not* the canonical review.
- Revised plan: same `.md` path; its `## Claude-review disposition` maps F1–F14 to fixes/decisions. The resolution was a later, **separate user request**: do not misstate that the original review invocation itself edited the plan. The requested future skill should combine these phases automatically when authorized.
- Existing relevant skills: `ai-coding-agents` (including its “Structured, read-only reviews with Claude Code” subsection), `superpowers:receiving-code-review`, `superpowers:writing-skills`, `superpowers:test-driven-development`. No installed skill named `handoff` was found by `skills_list` and inspection of local skill locations; this Markdown is the handoff substitute.

## What happened, precisely

There were **four** Claude CLI invocations, although **three** were needed before a valid review appeared:

1. `claude -p 'Review the implementation PLAN ... Return ONLY a single valid JSON object ...' --output-format text --tools Read,Glob,Grep --permission-mode plan` → exit 0, but final output only: “Nothing from this turn is worth saving to OpenBrain ...” No review. A user/project Stop hook apparently hijacked the final answer; classify as an observed symptom, not a proven root cause.
2. Another `claude -p ... --output-format json --tools Read,Glob,Grep --permission-mode plan` → JSON wrapper with `result` saying it did not save anything to OpenBrain; no `structured_output` review. CLI metadata showed about 100.8 s and $0.7033 for a **failed deliverable**, even though exit code was 0. The prompt's “do not invoke OpenBrain” did not solve the answer hijack.
3. `claude --safe-mode -p ... --output-format json --tools Read,Glob,Grep --permission-mode plan --json-schema '{...}'` → valid `structured_output`, 14 findings, `needs_revision`. About 155.0 s and $0.7415. `--safe-mode` disables hooks and project instruction auto-discovery: the prompt must carry the exact path, review scope, read-only boundaries, and relevant context. It also disables plugins and customizations; don't assume project CLAUDE.md is auto-loaded. The reviewer used the allowed read tools to inspect repo files. Review output was a CLI envelope; parse `structured_output`, or JSON-decode `result` as fallback.
4. `claude --safe-mode --resume <review-session-id> -p 'Condense the SAME verified findings...' --output-format json --tools '' --permission-mode plan --json-schema '{...}'` → condensed review saved to `.raw.json`, parsed to canonical `.json` (14 findings). This fourth call was **avoidable**: save `structured_output` from call 3 directly; request a concise schema and output budget up front. The user is right to flag repeated calls.

The final normalized JSON was independently read back. Its findings were not blindly applied; we compared them with local files and provider docs, then patched **only the plan**. Example decisions:

- Accepted: jsdom lacks native `<dialog>.showModal()` → test shim; default-off donate flag to avoid live broken button; Stripe `locale` sent; session `status` + `payment_status` distinguished; `onRequest` 405 handling; first browser locale precedence; session ID cleared from URL; privacy and stale UI text updated in plan.
- Accepted with alternative: `.js` ESM test compatibility handled by explicit Node 22 requirement (host was `v22.22.3`), not by changing CRA package to ESM. Cloudflare preview donations disabled by default rather than inventing a dynamic trusted origin.
- Accepted with security gate: €1 was our unsupported default, raised in revised plan to €5; WAF/Turnstile and Stripe Radar became release gates. `Origin` is CSRF mitigation only, not bot authentication.
- Pushed back on unverified legal detail: don't assert a definitive GDPR legal basis or Stripe controller/transfer status without counsel/provider evidence; require a reviewed Stripe privacy section instead.
- The plan was verified for all review themes via a read-only script and `git diff --check`, but this is **plan reconciliation**, not proof of working code or live payments. No code was implemented/deployed and no real charge occurred.

## Proposed one-call review contract

Use a self-contained read-only Claude prompt naming target absolute path, repo root, user requirements, allowed read scope, high-risk review dimensions, **no edits / external provider calls / secrets / deploy**, and the exact output schema. Start with `--safe-mode` **proactively** on this host, not after two broken outputs. Use `--output-format json`, `--json-schema`, `--tools Read,Glob,Grep`, `--permission-mode plan`, and a bounded timeout/budget. The `--safe-mode` tradeoff is explicit prompt context rather than hooks taking the final answer. Avoid `--tools ''` on the initial review because it cannot inspect the repository. Verify installed Claude CLI/auth/workdir first; don't expose keys or read `.env`.

Suggested schema (keep findings concise; include verifiable location/evidence):

```json
{
  "type": "object",
  "properties": {
    "verdict": {"type": "string", "enum": ["ready", "needs_revision", "blocked"]},
    "summary": {"type": "string"},
    "findings": {"type": "array", "items": {"type": "object", "properties": {
      "id": {"type": "string"},
      "severity": {"type": "string", "enum": ["critical", "major", "minor"]},
      "location": {"type": "string"},
      "issue": {"type": "string"},
      "evidence": {"type": "string"},
      "recommended_change": {"type": "string"}
    }, "required": ["id", "severity", "location", "issue", "evidence", "recommended_change"]}},
    "open_questions": {"type": "array", "items": {"type": "string"}}
  },
  "required": ["verdict", "summary", "findings", "open_questions"]
}
```

Potential tool invocation shape (illustrative, **not** a secret-bearing command): `claude --safe-mode -p '<self-contained review prompt>' --output-format json --json-schema '<schema>' --tools Read,Glob,Grep --permission-mode plan`. Prefer `subprocess.run([...], cwd=repo, capture_output=True, text=True, timeout=...)` with argv (not shell-quoted user input); parse the outer JSON once, then `outer.get('structured_output') or json.loads(outer['result'])`. If the CLI returns empty/irrelevant prose despite exit 0, schema-invalid output, missing required fields, or no findings despite `needs_revision`, mark the attempt invalid. Retry **once** with a focused corrective prompt and no previous session unless a resume is intentionally helpful; report a blocker rather than looping endlessly. Keep full raw wrappers in scratch only if needed for debugging; save normalized review without credentials to a stable artifact. Verify JSON parse, IDs unique, severity enum, actual finding count, and exact target path.

## Automatic resolution contract

1. Default to **automatic review + reconciliation** when the user requested review *and edits*, or has an explicit standing workflow preference. If user asked only “review”, don't silently edit a project; offer or request permission. In this example, review-only came first, and the next user message authorized plan edits.
2. For each `finding`: locate cited plan/code, check claim against actual files, provider docs for external API facts, and user's explicit requirements. Assign disposition `accepted`, `modified`, `rejected`, or `needs_user_decision`, with rationale and target section/file. Store a small machine-readable disposition list alongside the review if useful. Never mechanically apply reviewer wording that invents legal claims, changes the user's exact copy, weakens tests, or crosses a live-deployment/real-charge boundary.
3. Apply accepted/modified edits to the requested artifact (a plan Markdown in this example) **in the same workflow** when authorized. Preserve plan-only constraints, unrelated repo changes, and secrets. Use targeted patches, not a bulk rewrite that might lose requirements. Do not let Claude's review agent mutate the repo.
4. Re-read the edited artifact and run structural consistency checks: no stale status enum, test expectations match implementation interfaces, paths exist or are named as planned creations, all IDs have explicit disposition, no conflicting deployment/preview instructions, and `git diff --check` where appropriate. For code reviews, run the relevant tests after each accepted change and full suite before claiming success; do not substitute mock responses for real provider proof.
5. If a genuine choice is unresolved (e.g. user-mandated €1 vs an abuse-minimum recommendation, legal/tax categorization, paid account eligibility), stop only that dependent resolution and ask one concise question; continue independent edits where safe. Distinguish *plan fixed* from *implementation verified* and *live release approved*.
6. Report reviewed target, normalized review path, revised artifact path, counts/dispositions, any rejected claims, unresolved decisions, and what was **not** executed. For external writes, read back exact target before claiming success.

## Future skill creation / validation

- First read `superpowers:writing-skills` and its TDD background; create pressure scenarios **before** writing the skill. Existing history offers a documented baseline: non-safe Claude calls ended in OpenBrain text and a manual fourth condensation; a fresh controlled baseline should demonstrate failure in the future skill authoring process. Test with `delegate_task` or another fresh-context agent where possible.
- Pressure scenarios: (a) Claude exits 0 with unrelated Stop-hook text; (b) `structured_output` valid but `result` misleading; (c) 14 findings include a legal overclaim and a user-copy conflict; (d) `needs_revision` but `findings=[]`; (e) user asks review-only vs review-and-fix; (f) repo has unrelated dirty files and credentials. Desired behavior: one valid review artifact, automatic *authorized* reconciliation, bounded retry, no secret/external side effects.
- Micro-test wording with control if this is a behavior-shaping skill; then test with the skill loaded. Do not deploy an untested skill. Use `skill_manage` to create only after the failing scenario and to link a compact reference/template if needed; follow the skill's supported path and naming constraints. No git commit/push or public posting without user approval.
- The `ai-coding-agents` skill already contains a structured Claude read-only review section. The new skill should specialize **review + verified reconciliation**, not replicate general coding-agent discovery. If a separate skill cannot justify a distinct trigger, extend that skill instead; user's explicit target is a `claude-review` skill, so favor a focused new one with cross-link.

## Constraints / gaps that remain

- This handoff does not prove Cloudflare Pages deploy mode or Stripe account eligibility; those were unresolved release gates in the example.
- CLI flags and hook behavior are version-specific (`claude --version` was `2.1.325` in the example); validate with `claude --help` before turning the invocation into a long-lived skill.
- `--safe-mode` may change authentication/context availability in other environments. If it cannot authenticate, use the least invasive alternative that disables hooks via supported settings; do not silently fall back to uncontrolled prompts or unrestricted Bash/tools.
- Original user asked for a *handoff*, not immediate skill installation. Stop after creating/verifying this document; future worker should explicitly act on it when asked to build the skill.
