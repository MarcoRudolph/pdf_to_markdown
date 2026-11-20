---
description: "Provenance, intended deviations and test contract for the Figma redesign of the QCheckIn Kontaktdaten step (frame 7:312) and the step footer (6:513)"
summary: "Reference render 02-kontaktdaten.png comes from Figma NW1VqaB6ud5AGCCLOlWnW3 frame 7:312 (lastModified 2026-10-27T08:21:59Z, REST export). New: StepFooter (6:513) with Abbrechen = kiosk restart, disabled while a PATCH is open; 44px inputs with #8796AB border (token --qc-input-border); 12/16.8 field labels. Deviations: Inter, header fullscreen button, focus ring, error band above the footer (error state only). E2E: one invariant replaced (Weiter + Abbrechen instead of one action), KontaktdatenFigmaTests and KontaktdatenCancelTests added, CssVariablesTests row added; compiled, NOT run. Pixel diff not run."
paths:
  - "./SOURCE.md"
  - "./02-kontaktdaten.png"
  - "../../src/components/Kontaktdaten.tsx"
  - "../../src/components/StepFooter.tsx"
  - "../../src/components/ui/button.tsx"
  - "./rollback/02-evidence.md"
---

# Figma source — QCheckIn Kontaktdaten (tab 2)

Same method as tab 1 (`SOURCE.md`); only what differs or is new is listed here.

## Provenance

| Item         | Value                                                                       |
|--------------|-----------------------------------------------------------------------------|
| File         | `NW1VqaB6ud5AGCCLOlWnW3` ("Patient checkin")                                |
| Frame        | 7:312 "2 · Kontaktdaten", 768×1024                                          |
| Components   | 6:504 Header (done in tab 1), 6:513 Footer (variant "Left=Abbrechen")       |
| lastModified | 2026-10-27T08:21:59Z                                                        |
| Export       | 2026-10-27, REST `/v1/images` (PNG scale 1), `/v1/files/.../nodes` (values) |

| Render                 | sha256                                                             |
|------------------------|--------------------------------------------------------------------|
| `02-kontaktdaten.png`  | `56bf5602fe86edf853c59cfbb1d82d8b714d5d9058d9e41e51c5b601a3b378a6` |

## Measured values (frame origin 116, 4030)

| Node                     | Value                                                                              |
|--------------------------|------------------------------------------------------------------------------------|
| Content 7:333            | padding 40/32/40/32, gap 32; title block gap 8; fields gap 20; label→input gap 8   |
| Title / task             | `.qc-title` 24/32 600 `#0E0E2C` at y 124; `.qc-subtitle` 16/20 `#475569`           |
| Field label              | 12 / 16.8 (140%), 500, `#475569`; Telefon y 216, E-Mail y 305                      |
| Input                    | 704×44 at x 32, padding 10, 1px `#8796AB`, radius 6, 14/20 `#0E0E2C`; y 241 / 330  |
| Hidden instance layers   | info icon, left/right icons, unit, hint + counter — not rendered                  |
| Footer                   | 80 high, white 60% glass, 1px `#E2E8F0` top, padding 16/32/24/8                    |
| Abbrechen / Weiter       | 38px pills, top y 962; Abbrechen ghost at x 8, Weiter `#3B3DDD` ending at x 736    |
| Weiter disabled (18:565) | pill `#F8FAFC`, label `#CBD5E1` (no opacity fade)                                  |

All values are written as explicit px: `html` is 18px in this app, so Tailwind scale steps are not Figma pixels (`h-44` would be 198px).

## Intended deviations (masks for a pixel diff at 768×1024)

| # | Deviation                        | Mask (x, y, w, h)              | Reason                                                                     |
|---|----------------------------------|--------------------------------|----------------------------------------------------------------------------|
| 1 | Inter instead of SF Pro / Work Sans | every text box              | Same as tab 1; Work Sans (labels) is replaced by Inter as well             |
| 2 | Fullscreen button in the header  | 580, 10, 44, 44                | Same as tab 1                                                              |
| 3 | Language trigger width           | 632, 10, 112, 44 (± text width)| Same as tab 1                                                              |
| 4 | Focus ring on inputs             | none (only while focused)      | 2px ring, 2px offset, outside the box; Figma has no focus state            |
| 5 | Error band above the footer      | none (only on a failed load/save) | `role="alert"`, fixed directly above the actions, never scrolls away (§37) |
| 6 | Disabled Abbrechen label grey    | none (only while saving)       | Figma has no disabled ghost; uses the disabled-Weiter grey `#CBD5E1`       |

Everything outside masks 1–3 is expected to match on the happy path.

## Behaviour added with the design

- **Abbrechen** calls the same `handleRestart` as "Fertig": session dropped, language German, back to card read. No confirmation (user decision 2026-10-27; Figma has no frame for one).
- While a PATCH is open, **Abbrechen is disabled**: a started write is not rolled back, so the kiosk must not suggest nothing was saved.
- A synchronous re-entry guard makes a double tap on Weiter send one PATCH.
- An unmount guard stops a late PATCH answer from advancing or showing an error after the step is gone. No UI path reaches it today (Abbrechen is locked first); it covers future paths such as an idle reset (3b).

## Test contract (QService `tests/QCheckIn.E2E`)

Invariants restated first; an assertion changed only where its invariant was deliberately replaced.

| Test / assertion                                        | Invariant                                       | Status   | Why                                                                                   |
|---------------------------------------------------------|-------------------------------------------------|----------|---------------------------------------------------------------------------------------|
| `KontaktdatenStepTests` `main button` count = 1         | exactly one action on the step                  | replaced | Footer 6:513 adds Abbrechen; now = 2 and the second one is asserted to be "Abbrechen" |
| `KontaktdatenStepTests` h2, subtitle, 2 inputs, prefill, no name/address, header | content of the step       | kept     | `<h2>`, ids and texts unchanged                                                       |
| `KontaktdatenStepTests` clear-fields / write-back       | no deletion by clearing; number to source column | kept    | Save logic unchanged                                                                  |
| `KontaktdatenFigmaTests` (new)                          | computed style + geometry of the measured values | added   | Complements the masked pixel diff                                                     |
| `KontaktdatenCancelTests` (new)                         | Abbrechen restarts; no restart while saving; one PATCH per tap; error visible above the footer | added | Review findings #2, #5, #6 |
| `CssVariablesTests` `--qc-input-border`                 | tokens resolve to their specified values        | added    | New token for the input stroke                                                        |
| `ButtonHeightTests`                                     | pinned height of the probed primary action      | kept     | Probes step 1 only                                                                    |

The new tests mock GET/PATCH `/api/patients/{id}` and flip `is_master_data_enabled` in the fetched kiosk config (`KontaktdatenMock`), so they write no patient row.

## Open — not proven

- the masked pixel diff against `02-kontaktdaten.png`
- the E2E run of the tests above (they compile: `rollback/02-evidence.md`)
- the live URL `http://localhost:4711/qcheckin/<slug>/`

No browser, QService or database was used while making this change.
