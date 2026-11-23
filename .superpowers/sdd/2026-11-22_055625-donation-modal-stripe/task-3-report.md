# Task 3 report — donation modal

Status: committed `b24e0f6` (`feat: add accessible bilingual donation modal`) on `feature/donation-modal-stripe`; working tree clean at commit. No external calls, deployment, or push.

## Evidence
- RED: focused Jest initially failed to resolve missing `./DonationModal`. Additional tests were observed failing for missing `navigator.language` fallback, acceptance of Stripe's bare root URL, and late redirect after unmount; each was fixed and rerun green.
- GREEN: focused modal suite 36/36; full CRA frontend suite 40/40 (2 suites); Node proxy suite 8/8; Pages/shared backend suite 70/70.
- ESLint for modal, modal tests and setupTests exited 0; `CI=true npm run build` compiled successfully; `git diff --check` and staged diff check exited 0.
- Build currently does not bundle DonationModal because parent App integration is Task 4; Jest transpiled and exercised the component directly.

## Files
- `pdf_to_markdown/src/DonationModal.js`: native dialog; exact DE/EN text; locale resolver; integer EUR choice and validated cents payload; synchronous in-flight guard; generic errors/retry; Stripe checkout URL validation; no late navigation after unmount; unsupported-browser fallback.
- `pdf_to_markdown/src/DonationModal.test.js`: locale matrix/fallback, copy/accessibility, preset/custom bounds, payload, duplicate submission, failure/retry, URL rejection, close/cancel, unmount and StrictMode coverage.
- `pdf_to_markdown/src/setupTests.js`: showModal/close shims only where JSDOM lacks them.
- `pdf_to_markdown/src/App.css`: modal responsive/backdrop/touch targets, token colors, enabled-only Donate pointer cursor.

## Self-review / concerns
- The test navigation prop exists solely because JSDOM cannot spy on `window.location.assign`; production default calls `window.location.assign`.
- Native Escape/focus trap and visual responsive behavior rely on browser `<dialog>`/CSS, not JSDOM. No browser-level visual test was run. The cancel event is dispatched directly in tests, not simulated via Escape.
- Task 4 still owns App trigger, actual locale handoff, and returning focus to that trigger. No claim of live checkout readiness.

## Important review findings — fix round 1
- **RED:** Added numeric-region locale regressions (`de-419`, `de-Latn-419`) and an isolated CSSOM dialog sizing regression. `CI=true npm test -- --watch=false --runInBand src/DonationModal.test.js` reported 3 failed, 36 passed: both numeric regions returned `de` instead of `en`, and dialog's own computed `box-sizing` was empty (not `border-box`).
- **Root causes/fixes:** Locale extraction recognized only two-letter regions; now it recognizes either two-letter or three-digit regions after the language subtag. The dialog rule lacked its own `box-sizing: border-box`; added it so declared viewport width and max-height include padding/border. Global `*` reset did not establish this contract on the isolated native dialog rule.
- **GREEN:** Focused modal suite 39/39; full frontend suite 43/43 (2 suites); `CI=true npm run build` compiled successfully. JSDOM does not compute `min()`/`dvh` geometry, so the sizing regression verifies computed dialog `box-sizing` with the rule isolated from the global reset and checks the parsed CSSOM viewport constraints; no browser-level geometry claim.
- Preset/custom stale value remains deferred Minor; no external calls, deployment, or push in this fix round.
