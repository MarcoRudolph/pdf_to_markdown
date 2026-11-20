---
description: "Provenance, intended deviations, open risks and test contract for the Figma redesign of the QCheckIn Zustimmung step (frames 8:323, 8:360, 22:834, 22:855) and the per-kiosk PDF heading/Karteitext settings"
summary: "Renders 04-*.png from Figma NW1VqaB6ud5AGCCLOlWnW3 (lastModified 2026-10-27T08:21:59Z). The document card renders the stored PDF instead of Figma's placeholders; title = per-kiosk pdf_heading (QServiceUI group 'PDF', default 'Zustimmung', verbatim in every language); Karteitext = '<pdf_karteitext> (Uhrzeit=HH:mm)', empty = old 'PDF Dokument: …'. New 4c sending and 4d failed screens; 4d adds Abbrechen; stamping happens once, a stamp error is a card error. Verified: static gate + fully mocked headless Playwright probe (0 unmocked /api calls) with measured positions; icons redrawn because the Figma image API was rate-limited. Found pre-existing: shared header renders 96px instead of 84 (rem classes at html 18px). E2E written+compiled, not run; live QService + QServiceUI GroupBox + real Kartei row are human acceptance. 2026-10-28: 22:834 became the shared WaitingScreen (also after card read and during the Anamnese save, per-step titles); its arc is an inline SVG that rotates and breathes, and under reduced motion it is the Figma frame (probe: 0.17 % arc pixels off)."
paths:
  - "./SOURCE-03.md"
  - "./04-zustimmung.png"
  - "./04b-zustimmung-unterschrieben.png"
  - "./04c-wird-gesendet.png"
  - "./04d-senden-fehlgeschlagen.png"
  - "../../src/components/Zustimmung.tsx"
  - "../../src/components/SignaturePad.tsx"
  - "./rollback/04-evidence.md"
  - "./rollback/05-evidence.md"
  - "../../src/components/WaitingScreen.tsx"
---

# Figma source — QCheckIn Zustimmung (tab 4)

Same method as tabs 1–3 (`SOURCE.md`, `SOURCE-02.md`, `SOURCE-03.md`); only what differs or is new is listed here.
Plan and review: `C:\Users\Marco\.claude\plans\refactored-wobbling-origami.md` and `…-review.md` (all findings resolved in the plan).

## Provenance

| Item         | Value                                                                                       |
|--------------|---------------------------------------------------------------------------------------------|
| File         | `NW1VqaB6ud5AGCCLOlWnW3` ("Patient checkin")                                                |
| Frames       | 8:323 "4 · Zustimmung", 8:360 "4b · unterschrieben", 22:834 "4c · Wird gesendet", 22:855 "4d · Senden fehlgeschlagen" (all 768×1024) |
| Components   | 6:504 Header, 6:513 Footer, chip "Löschen" 8:395 (same component as the language chip)      |
| lastModified | 2026-10-27T08:21:59Z                                                                        |
| Export       | 2026-10-27, REST `/v1/images` (PNG scale 1) and `/v1/files/.../nodes` (values)              |
| Icons        | **Redrawn**, not exported: the images and nodes endpoints answered 429 (`retry-after` ≈ 4 days) after the PNG export. See "Open". |

| Render                               | Frame  | sha256                                                             |
|--------------------------------------|--------|--------------------------------------------------------------------|
| `04-zustimmung.png`                  | 8:323  | `61814f71b5e22c28caa4c430a518d6031e7804b6be773514146aa93689467b2b` |
| `04b-zustimmung-unterschrieben.png`  | 8:360  | `18223813d9ba0d37146734e99cbd2c4c3754c9b9ae83ba5231c5d675e327a9a1` |
| `04c-wird-gesendet.png`              | 22:834 | `92733d1603d0678173917f7ad66055f76163bd6b0a756022b1dfa1a83700a645` |
| `04d-senden-fehlgeschlagen.png`      | 22:855 | `be152c2a453e6594912baed2590f0d7e1f81ddf82f3a45f88a1831a3cf4fbc88` |

| Icon (src/assets/icons)            | Figma node           | How it was made                                                         |
|------------------------------------|----------------------|-------------------------------------------------------------------------|
| ~~`icon-wird-gesendet.svg`~~       | 22:852 (64px)        | 270° arc r 23, stroke 4.5 #4F46E5, round caps, measured from the render. **Removed 2026-10-28**: now the inline `Spinner` in `WaitingScreen.tsx`, same geometry as a 270° dash |
| `icon-senden-fehlgeschlagen.svg`   | 22:873 (80px)        | from node geometry: ring r 30 stroke 3, line 26–44 stroke 3, dot at 54 stroke 4 |
| `delete_300.svg`                   | I8:395;7744:22860    | Material "delete" look-alike, 20px, stroke 1.25 #1E293B                 |

## Measured values (frame-relative)

| Node                     | Figma                                             | Implementation (probe, 768×1024)                       |
|--------------------------|---------------------------------------------------|--------------------------------------------------------|
| Content 8:344            | padding 40/32/32/32, gap 32                       | same (`px-[32px] pt-[40px] pb-[32px] gap-[32px]`)      |
| Title 8:345              | `.qc-title` y 124, `.qc-subtitle` y 164, gap 8    | 24/32/600 #0E0E2C, gap 8; y 136/176 (header +12, see Open) |
| Document card 8:348      | 704×480, white, 1px #E2E8F0, r 16, padding/gap 14 | 704 × ≤480 (469 because of the header), same styles    |
| Signature label 8:354    | 12/16 medium #475569                              | same                                                   |
| Pad 8:355                | y 752, 704×160, 1px #8796AB, r 6                  | y 752, 704×160, same stroke/radius                     |
| Löschen chip 8:395       | x 639, y 760, 89×28                               | x 639, y 760, 89×28, in a 44px button                  |
| Footer 6:513             | y 944, h 80                                       | y 944, h 80                                            |
| Weiter                   | 94×38 at x 642; disabled #F8FAFC/#CBD5E1          | box x 643 w 93 h 44, body 38                           |
| 4c/4d illustration       | 150px circle #EEF2FF, centred in the content area | same; +16px lower because the step header stays (see deviations) |

## Intended deviations (masks for a pixel diff at 768×1024)

| #  | Deviation                                         | Mask (x,y,w,h)              | Why                                                                                   |
|----|---------------------------------------------------|-----------------------------|---------------------------------------------------------------------------------------|
| 1  | Inter instead of SF Pro                           | text runs                   | As tabs 1–3                                                                           |
| 2  | Fullscreen button in the header                   | 580, 10, 44, 44             | As tabs 1–3                                                                           |
| 3  | PDF pages instead of "[Titel des Dokuments]/[Absatz …]" | 47, 229, 674, 452     | User: the fields are not needed, the stored PDF is still loaded and rendered          |
| 4  | Title text = per-kiosk `pdf_heading`              | 32, 124, 704, 32            | User: QServiceUI "PDF Heading", default "Zustimmung", verbatim in every language      |
| 5  | Abbrechen instead of "‹ Zurück"                   | 8, 959, 124, 44             | Precedent SOURCE-03 #4: kiosk restart, no back navigation                             |
| 6  | 4c/4d keep the step header (Figma: 64px header without progress) | 0, 0, 768, 96 | Review M3: the header variant is derived from the step; no new header state for this tab |
| 7  | 4d: ghost Abbrechen next to "Erneut versuchen"    | 250, 664, 100, 44           | Review M5: no dead end when the server stays down                                     |
| 8  | 4c arc animates: turns (1.4 s) while its length breathes 270° → 72° → 270° (`.qc-spinner` in index.css) | 352, 466, 64, 64 | User 2026-10-28: "animate the waiting icon". Under prefers-reduced-motion it is the static Figma arc, so pixel diffs run with reduced motion |
| 9  | No stray `add_300` icon in the Löschen chip       | none (chip measured 89×28)  | Leftover icon slot of the shared chip component                                       |
| 10 | Card height is a maximum, not fixed               | none at 768×1024            | Review M4: pad and footer must stay on screen in landscape / with the notice line     |
| 11 | German-only notice under the subtitle (non-de)    | none for de                 | P-04, only when the language is not German                                            |

## Behaviour changed/added with the design

- **Heading** comes from `/api/qcheckin/config` → `pdf_heading` (new column `qcheckin_kiosks.pdf_heading`, NOT NULL DEFAULT 'Zustimmung'). Missing or blank → "Zustimmung".
- **Karteitext**: if the kiosk has `pdf_karteitext`, the signed PDF is filed with `karteitext = "<text> (Uhrzeit=HH:mm)"` (invariant, max 104 + 16 = 120). Empty → unchanged `PDF Dokument: <name> (Uhrzeit=HH:mm)`. Not on the token-free config route.
- **Submit**: Weiter → 4c immediately (a second tap cannot send twice) → stamp once → POST. Success → Bestätigung. Server/network failure → 4d; "Erneut versuchen" resends the **same** stamped bytes; Abbrechen restarts the kiosk. A stamp failure returns to the form with the error in the card (no 4d).
- **Löschen** exists only while there is ink (8:323 has none). A changed signature invalidates the stamp.
- The "Bitte unterschreiben Sie zuerst" hint is gone: the Figma label already says why Weiter waits (key `zustimmung.signFirst` removed from all 7 locales).

## Waiting screen reuse (2026-10-28)

Frame 22:834 is the shared `WaitingScreen` (`src/components/WaitingScreen.tsx`, layout in `StatusScreen.tsx`) for every step that makes the patient wait on the server. Plan: `C:\Users\Marco\.claude\plans\velvety-tickling-parasol.md`.

| Where       | When                                                     | Test id              | Title (de)                       |
|-------------|----------------------------------------------------------|----------------------|----------------------------------|
| Anmeldung   | after the card is read: identity check + Termin lookup   | `step1-waiting`      | Ihre Daten werden geprüft        |
| Anamnese    | while the PUT runs, as an overlay over the mounted form  | `anamnese-saving`    | Ihre Angaben werden gespeichert  |
| Zustimmung  | while the stamped PDF is sent (unchanged)                | `zustimmung-sending` | Ihre Anmeldung wird gesendet     |

- Body is "Einen Moment bitte." everywhere. New keys `anmeldung.checking.*` and `anamnese.saving.*` in all 7 locales; `anmeldung.statusVerifying` / `statusAppointment` removed (no longer reachable).
- Card read: while the patient handles the card (`init`, `reading`) the card column stays. An error after the waiting screen returns to the column as before.
- Anamnese: overlay instead of replacing the form, so a failed save returns with scroll position, answers and the error above the footer intact. The form is `aria-hidden` while it is covered.
- Kontaktdaten keeps its disabled Weiter (user decision).
- Deviations: title text differs from Figma on Anmeldung/Anamnese (title line, 704×32). On Anmeldung the step header has no progress bar, so the column sits 5px (not 16px) below Figma.
- Probe (`rollback/05-evidence.md`): arc region 0.17 % pixels off under reduced motion in all three places; 3 distinct frames in 400 ms when animated; a tap at the footer hits the waiting screen; 0 unmocked `/api` calls.
- Known risk: `verifying` is often short, so the screen can flash on a fast server. No artificial minimum duration; add a show delay if it looks jumpy live.

## Open risks

- **Duplicate chart rows (review m7)**: if the server files the PDF but the answer is lost, "Erneut versuchen" files a second row. There is no idempotency key; out of scope for this milestone.
- **Migration blast radius (review m6)**: until QService has started once as the table owner (quincywin) with this build, the new columns are missing and `/config` fails with 42703 for every kiosk. The migration logs a WARN naming the step.
- **Shared header is 96px, Figma 84px** (pre-existing, tab 1): `Header.tsx` uses rem classes (`h-16`, `pb-4`, `h-1`) under `html { font-size: 18px }`. It shifts every step's content 12px down; the Figma tests of tabs 2/3 (never run) assert 84 and would fail. Not changed here (out of scope, shared file with tab-1 hunks). The language chip has the same rem issue (`h-7` → 31.5px).

## Test contract (QService tests)

All new tests live in `tests/QCheckIn.E2E/Zustimmung/` (mock `ZustimmungMock.cs`: catch-all `**/api/**` first, two hand-built PDFs: a 2-page document and a 1-page empty-password-encrypted one that pdf.js renders and pdf-lib refuses). Every test ends with `AssertNothingUnmocked()`. **Compiled (0 errors, 0 warnings), not run.** No existing E2E invariant was replaced: before this tab no E2E test covered Zustimmung.

| Test                                                                   | Invariant                                                                                          | Status   |
|------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|----------|
| `ZustimmungFigmaTests.Unsigned_8_323_MatchesFigma`                     | heading main+40, card/pad/footer geometry and styles; no Löschen chip; Weiter disabled; 0 submits  | added    |
| `ZustimmungFigmaTests.Signed_8_360_MatchesFigma`                       | chip 639/760 89×28 in a 44px box; Weiter enabled #3B3DDD/white; signing alone sends nothing        | added    |
| `ZustimmungFigmaTests.Sending_22_834_MatchesFigma`                     | held submit → 4c: 150px circle `--qc-illu-bg`, exact title, no form actions; 1 submit              | added    |
| `Waiting/WaitingScreenFigmaTests` (3 contexts × animated / reduced)   | held request → 22:834 in the main area: 150px `--qc-illu-bg` circle, 64px spinner centred, exact title + "Einen Moment bitte.", no button, footer tap hits the screen; animation names set, `none` under reduced motion; Anamnese keeps the typed value | added 2026-10-28 |
| `AnamneseCancelTests.Abbrechen_Is_Disabled_While_Saving_…`             | invariant kept (actions locked while saving, one PUT); now also `anamnese-saving` visible; the disabled check waits for `Attached` because the overlay covers the button | changed 2026-10-28 |
| `ZustimmungFigmaTests.SendFailed_22_855_MatchesFigma`                  | 500 → 4d: exact title, ghost Abbrechen left of filled "Erneut versuchen", both ≥ 44px               | added    |
| `ZustimmungLayoutTests` (768×1024 de, 768×1024 tr, 1024×768 de)        | footer bottom ≤ innerHeight, pad fully visible, no horizontal scroll; tr shows the German-only line | added    |
| `ZustimmungCancelRetryTests.Two_Failed_Submits_…_Abbrechen_Restarts`   | one tap = one submit; both bodies identical; Abbrechen → step 1, no third submit                   | added    |
| `ZustimmungCancelRetryTests.Configured_Heading_…_Also_In_English`      | `pdf_heading` shown verbatim in de and after switching to en                                       | added    |
| `ZustimmungCancelRetryTests.Missing_Pdf_Heading_Falls_Back_To_Zustimmung` | no `pdf_heading` → "Zustimmung"                                                                 | added    |
| `ZustimmungCancelRetryTests.Tap_On_Loeschen_Chip_Clears_And_Adds_No_Ink` | tap on the chip clears, adds no ink, chip disappears, Weiter disabled                             | added    |
| `ZustimmungCancelRetryTests.Stamp_Failure_Shows_Document_Error_In_Card_Not_Retry_Screen` | stamp error → card error, no 4d, 0 submits                                       | added    |
| `Snapshots/QCheckInConfig_E2eSlug.verified.json`                       | public config shape; gains `"pdf_heading": "Zustimmung"`, never `pdf_karteitext`                   | changed  |
| `Snapshots/QCheckInConfig_DefaultSlug.verified.json`                   | untouched; pre-existing red (live `default` row has signature + debug on)                         | kept     |

QService.Tests (DB-free, **run: 11/11 green** with `QSERVICE_TEST_CONNECTION` pointing at port 1, from a scratch copy of the test project because a foreign file currently breaks its build):

| Test                                              | Invariant                                                                                   | Status |
|---------------------------------------------------|---------------------------------------------------------------------------------------------|--------|
| `KioskPdfTextTests` (9)                           | normalise/validate (blank → Zustimmung, trim, control chars, 60/61, 104/105); `""` vs `{}`; config response has no Karteitext | added  |
| `KarteiRepositoryTests.ConfiguredKarteitext*` (2) | `X (Uhrzeit=14:02)`, also under fi-FI                                                       | added  |
| `KioskPdfTextRoundTripTests` (DB)                 | create default, PATCH round trip, clear via `""`, other PATCH leaves both alone             | added, **run by the human** (needs table owner) |

## Open — not proven

- Pixel diff with the masks above (only side-by-side visual review + measured positions).
- E2E run (written and compiled only; running is not allowed on this machine).
- Live URL `http://localhost:4711/qcheckin/default/` with the new bundle (needs a QService restart from VS).
- QServiceUI GroupBox "PDF" rendering (built, not looked at).
- A real signature writing `<text> (Uhrzeit=…)` into qwkartei.
- Icons: re-export 22:852, 22:873 and I8:395;7744:22860 once the Figma API quota resets, and replace the redrawn SVGs.
