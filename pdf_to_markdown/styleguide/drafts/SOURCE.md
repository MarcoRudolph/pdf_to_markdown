---
description: "Provenance, intended deviations and test contract for the Figma redesign of QCheckIn tab 1 (Karte einlesen), header and language menu"
summary: "Reference renders come from Figma NW1VqaB6ud5AGCCLOlWnW3 (frames 6:514, 6:541, 6:567; lastModified 2026-10-27T08:21:59Z), exported through the REST API. Intended deviations: Inter instead of SF Pro, a 44px fullscreen button in the header, 44px language-menu rows (7 languages) and a 90% menu fill. Each has a mask rectangle for pixel diffs. The test-contract table lists which E2E assertions stay and which were rewritten, and why. Pixel diff and E2E run are still open and need an isolated environment."
paths:
  - "./01-karte-einlesen.png"
  - "./01b-kein-termin.png"
  - "./01-sprachmenue.png"
  - "../../src/pages/KarteEinlesenPage.tsx"
  - "../../src/components/Header.tsx"
  - "../../src/components/LanguagePicker.tsx"
  - "../../scripts/check-locales.mjs"
---

# Figma source — QCheckIn tab 1

## Provenance

| Item            | Value                                                                                         |
|-----------------|-----------------------------------------------------------------------------------------------|
| File            | `NW1VqaB6ud5AGCCLOlWnW3` ("Patient checkin")                                                  |
| Frames          | 6:514 Karte einlesen, 6:541 Kein Termin, 6:567 Sprachmenü geöffnet                            |
| Components      | 6:504 Check-in / Header, 6:513 Check-in / Footer, 9:519 Language menu                         |
| lastModified    | 2026-10-27T08:21:59Z                                                                          |
| Export          | 2026-10-27, Figma REST API `/v1/images` (PNG scale 1, SVG), `/v1/files/.../nodes` for values  |
| Why REST        | The Figma MCP refused every read without edit access; the REST token only needs view access   |
| Icons           | `src/assets/icons/*.svg`: original SVG exports, unedited (instance ids for the library icons) |
| Font            | Inter 4.1, `Inter-4.1.zip` sha256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e` |

| Render                   | sha256                                                             |
|--------------------------|--------------------------------------------------------------------|
| `01-karte-einlesen.png`  | `2c0ca688fc3c635480205671ed79ef4961f4b6df3413bad27afbf5756d93c8d2` |
| `01b-kein-termin.png`    | `37055d996f6c54b1541655fe99134dd34b3ba8cc7ab7d29e138a2d2238c9ef08` |
| `01-sprachmenue.png`     | `69f63ee7f5a75a2e8952064140b0cb62339cf57aa0eaaabeba0183c7f5b3233e` |

## Intended deviations (masks for a pixel diff at 768×1024)

| # | Deviation                       | Mask (x, y, w, h)                  | Reason                                                                   |
|---|---------------------------------|------------------------------------|--------------------------------------------------------------------------|
| 1 | Inter instead of SF Pro         | every text box                     | SF Pro is Apple-only and may not be shipped; compare geometry, not glyphs |
| 2 | Fullscreen button in the header | 580, 10, 44, 44                    | Kiosk needs a deliberate fullscreen toggle (§15/§41); not in Figma        |
| 3 | Language menu: 44px rows, 7 entries | 512, 58, 240, 324 (`01-sprachmenue` only) | Non-overlapping 44px touch targets; 7 shipped languages instead of 5 |
| 4 | Menu fill 90% instead of 20%    | inside mask 3                      | Same on the white Figma frame, readable over forms on later steps         |
| 5 | Language trigger width          | 632, 10, 112, 44 (± text width)    | Width follows the active language name                                   |

Everything outside these masks is expected to match:
- header 64px, hairline `#E2E8F0`
- illustration 150px circle `#EEF2FF` with the 80px icon
- title 24/32 600, subtitle 16/20 `#475569`
- 32px gaps
- button pill 38px `#3B3DDD`, radius 12

## Test contract (QService `tests/QCheckIn.E2E`)

The invariants were restated first; assertions were changed afterwards and only where an invariant was deliberately replaced.

| Test / assertion                                              | Invariant                                    | Status     | Why                                                                                     |
|---------------------------------------------------------------|----------------------------------------------|------------|-----------------------------------------------------------------------------------------|
| `AnmeldungTapTargetsTests`, `KarteEinlesenTapTargetsTests`    | every target box ≥ 44×44                     | kept       | Buttons are real 44px boxes; the 38px pill is an inner span                              |
| `KarteEinlesenTapTargetsTests` (new case)                     | language rows ≥ 44 high, pairwise disjoint   | added      | The menu is new; overlap would make the tapped language ambiguous                       |
| `HeaderAssert.ActiveStepAsync`                                | exactly one `aria-current=step`, text = step | kept       | Now an sr-only `<li>`; innerText still carries the label                                 |
| `HeaderViewportTests` background = `--primary`                | header colour comes from a token             | replaced   | Figma header is white 70% glass; asserted as `rgba(255, 255, 255, 0.7)`                 |
| `HeaderViewportTests` label/bar centring                      | each label sits over its bar                 | replaced   | Labels are no longer drawn; progress segment count follows the flag formula instead     |
| `HeaderViewportTests` no overflow, fixed in kiosk mode        | header fits, stays on top                    | kept       |                                                                                         |
| `FontLoadingTests` Open Sans 400/700/italic served            | the shipped font cuts load                   | replaced   | Inter variable + italic; checks 200 + woff2 MIME and loaded faces for 400/700/italic    |
| `ButtonHeightTests` `kiosk` = 64                              | the primary action has a fixed, pinned height | replaced  | step 1 now uses `figma`: the box is 44 and the pill 38; `kiosk` is untouched on the other tabs |
| `CssVariablesTests` `--primary` = royal                       | tokens resolve to their specified values     | replaced   | `--primary` is #3B3DDD; rows added for `--qc-*` and `--radius`; `brand-*` rows unchanged |
| `AnmeldungViewportTests` `.heading-h1` 30 / `.heading-h4` 18  | step 1 type sizes are pinned                 | replaced   | Figma ramp: `.qc-title` 24, `.qc-header-title` 16 (E-1 still applies off step 1)        |
| `KarteEinlesenNoAppointmentTests`                             | 404 → retry visible, stays on step 1         | kept       | Selectors unchanged                                                                     |
| `KarteEinlesenErrorReasonTests` (new)                         | 404 / 500 / network / 401 map to the right screen | added | Review #9: a server error must never say "kein Termin"                                  |
| `KarteEinlesenFigmaTests` (new)                               | computed style of the measured values        | added      | Complements, does not replace, the masked pixel diff                                    |

## Open — not proven

Collect these only in an isolated environment with its own DB, its own kiosk slug and conditional cleanup:
- the masked pixel diff against these renders
- the E2E run of the tests above
- the live URL `http://localhost:4711/qcheckin/<slug>/`

No browser, QService or database was used while making this change.
