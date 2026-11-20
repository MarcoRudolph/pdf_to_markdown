---
description: "Provenance, intended deviations, open risks and test contract for the Figma redesign of the QCheckIn Anamnese step (frames 7:411 viewport and 13:1224 full page)"
summary: "Renders 03-anamnese.png (7:411) and 03-anamnese-lang.png (13:1224) from Figma NW1VqaB6ud5AGCCLOlWnW3, lastModified 2026-10-27T08:21:59Z. 44px chips with colour-only selection (user decision, §17 exception), 44px inputs with in-field units, zero-height dividers, sticky glass footer (content scrolls under it). Deviations: Abbrechen instead of '‹ Zurück' (user), 44px checkbox rows, checked state, focus rings, error/retry band. New: a non-404 prefill error locks saving (Retry). OPEN: Freitext lost update vs. Medikationsplan (pre-existing, server-side, out of scope); pixel diff, E2E run and live URL not done — statically verified only (tsc, eslint, locales, vite build, E2E compile)."
paths:
  - "./SOURCE-02.md"
  - "./03-anamnese.png"
  - "./03-anamnese-lang.png"
  - "../../src/components/Anamnese.tsx"
  - "../../src/components/StepFooter.tsx"
  - "../../src/components/ui/OptionGroup.tsx"
  - "../../src/components/ui/checkbox.tsx"
  - "./rollback/03-evidence.md"
---

# Figma source — QCheckIn Anamnese (tab 3)

Same method as tab 1 (`SOURCE.md`) and tab 2 (`SOURCE-02.md`); only what differs or is new is listed here.
Plan and review: `C:\Users\Marco\.claude\plans\hashed-wandering-glacier.md` (rev 2) and `…-review.md`.

## Provenance

| Item         | Value                                                                       |
|--------------|-----------------------------------------------------------------------------|
| File         | `NW1VqaB6ud5AGCCLOlWnW3` ("Patient checkin")                                |
| Frames       | 7:411 "3 · Anamnese" 768×1024 (viewport), 13:1224 same, 768×1288 (full page) |
| Components   | 6:504 Header (tab 1), 6:513 Footer (variant "Left=Zurück"), Chip (Radio), Input, Checkbox, Divider |
| lastModified | 2026-10-27T08:21:59Z                                                        |
| Export       | 2026-10-27, REST `/v1/images` (PNG scale 1), `/v1/files/.../nodes` (values) |

| Render                  | Frame   | sha256                                                             |
|-------------------------|---------|--------------------------------------------------------------------|
| `03-anamnese.png`       | 7:411   | `4e4ed2df0d4a2023b5d5b99a02d3f8cc8fafef66807ad61ae8096c7d7c039f13` |
| `03-anamnese-lang.png`  | 13:1224 | `55b49bb464a155b547185e0810b131572a78674da9065e1e8b6ef2f7985900b6` |

## Measured values (frame-relative, 13:1224)

| Node                         | Value                                                                                    |
|------------------------------|------------------------------------------------------------------------------------------|
| Content 13:1226              | padding 40/32/40/32, gap 28 between title, sections and dividers                       |
| Title 13:1227                | `.qc-title` at y 124, `.qc-subtitle` at y 164, gap 8                                     |
| Section heading              | 16/20 600 `#0E0E2C`; Körperdaten y 212, Lebensgewohnheiten y 554, Gesundheit y 894       |
| Section inner gap            | 20                                                                                       |
| Chip group label             | 12/16 500 `#475569`, gap 8 to the chips                                                  |
| Chip (Radio)                 | 44 high, padding 6/16, radius 8, 14/20 500, gap 8, hug width                             |
| Chip unselected              | white, 1px `#64748B`, text `#64748B` (token `--qc-slate-500`, new)                       |
| Chip selected                | `#EEF2FF` (`--qc-illu-bg`), no stroke, text `#3730A3` (token `--qc-indigo-800`, new)     |
| Field label                  | 12/16.8 500 `#475569` (as tab 2)                                                         |
| Input                        | 44 high, padding 10, 1px `#8796AB`, radius 6, 14/20; placeholder `#64748B`               |
| Unit label                   | 14/20 500 `#475569`, right edge on the 10px padding                                      |
| Field widths                 | Größe/Gewicht 228, Allergie 704, Kreatinin 160                                           |
| Field positions (label/input)| Größe 340/365, Gewicht 429/454, Allergie 934/959, Kreatinin 1023/1048                    |
| Divider                      | 1px `#E2E8F0`, zero layout height, y 526 and 866                                         |
| Checkbox                     | 24px glyph, visible square 17 inset 4, stroke `#1E293B`; label 14/20 400 `#0E0E2C` at x 64 |
| Footer                       | 80 high glass (60 % white in 7:411), sticky; pills top y 962 in the viewport             |

Placeholders per Figma: "z. B. 175", "z. B. 75", "z. B. Penicillin", "z. B. 1,0". Labels lose the unit ("Größe in cm" → "Größe"), the unit sits in the field. Units are not translated (medical constants), and `aria-describedby` points at them.

## Intended deviations (masks for a pixel diff at 768×1024 / 768×1288)

| # | Deviation                          | Mask (x, y, w, h)                | Reason                                                                     |
|---|------------------------------------|----------------------------------|----------------------------------------------------------------------------|
| 1 | Inter instead of SF Pro / Work Sans | every text box                  | Same as tabs 1–2                                                           |
| 2 | Fullscreen button in the header    | 580, 10, 44, 44                  | Same as tab 1                                                              |
| 3 | Language trigger width             | 632, 10, 112, 44 (± text width)  | Same as tab 1                                                              |
| 4 | Abbrechen instead of "‹ Zurück"    | 8, 962, 110, 38 (viewport)       | User decision 2026-10-27: same action as Kontaktdaten (kiosk restart), no back navigation |
| 5 | 44px checkbox rows                 | everything from y 1112 (13:1224) | Two 44px targets do not fit Figma's 32px pitch; the page is 32px taller    |
| 6 | Checked checkbox                   | none (only when checked)         | Figma has no checked state: brand primary fill, white tick                 |
| 7 | Focus rings                        | none (only while focused)        | 2px ring, 2px offset; Figma has no focus state                             |
| 8 | Error / retry band above the footer | none (only on a failure)        | `role="alert"`; load failures add "Erneut versuchen"                       |

Not a deviation: the selected chip shows its state **by colour only**, exactly as drawn (user decision 2026-10-27, recorded as a §17 exception in `principles.md`).

## Behaviour changed with the design

- **Abbrechen** calls `handleRestart` (as on Kontaktdaten). Disabled while a PUT is open, since a started write is not rolled back.
- **A failed prefill locks saving** (review finding #2). Only a 404 means "nothing stored yet" and gives an empty, savable form. Any other failure (500, timeout, network, 401) shows `errors.anamneseLoad` with **Erneut versuchen**; inputs and Weiter stay disabled until a retry succeeds. `handleSave` checks the same condition itself, independent of the button state. Before this, an empty form after a 500 could be saved over the stored blob.
- A synchronous re-entry guard makes a double tap on Weiter send one PUT; an unmount guard stops a late PUT answer from advancing a restarted session.
- `applyPrefill` / `buildBlob` are byte-identical to before.

## Open risks — not solved here

1. **Freitext lost update (review finding #3, pre-existing).** The kiosk reads `Freitext` once on load and writes the whole blob back; `AnamneseRepository.UpsertAsync` (QService `src/QService/Patients/AnamneseRepository.cs`) overwrites `valuestring` with no version check. If the practice edits Freitext in the Medikationsplan between the kiosk's GET and PUT, the kiosk restores the old text. This exists independently of the redesign and needs a server-side fix, which the frozen-API milestone excludes. **Ticket proposal:** inside `UpsertAsync`, `SELECT … FOR UPDATE` the row and merge only the kiosk-owned keys (SozialeParameter, KlinischeParameter, Gesundheit) into the stored JSON, keeping Freitext and unknown keys; or require the `lastchange` read with the GET and answer 409 on mismatch.
2. **A corrupt stored row reads as 404.** `GetAsync` maps unparseable JSON to `null` → 404, so the kiosk shows an empty form and a save replaces the corrupt row. Distinguishing the two needs a server change (same ticket).
3. **E2E harness seeding.** The new tests mock every `/api/*` call, but the assembly hook (`AssemblyHooks.InitAsync`) still seeds the test patient and kiosk in the shared DB for the whole E2E assembly. Running any E2E test therefore still touches the DB.

## Test contract (QService `tests/QCheckIn.E2E`)

| Test / assertion                                   | Invariant                                                   | Status        | Why                                                              |
|----------------------------------------------------|-------------------------------------------------------------|---------------|------------------------------------------------------------------|
| `AnamneseTapTargetsTests`                          | every interactive element ≥ 44×44                           | kept          | Chips 44, checkbox rows 44, inputs 44, figma buttons 44          |
| `AnamneseViewportTests`                            | no horizontal scroll; `step2-save` above the fold           | kept          | Comment updated: footer now sticky inside the scroll area        |
| `AnamneseInteractionTests`                         | one primary action, no hover-only classes                   | kept          | Abbrechen is secondary (ghost)                                   |
| `AnamneseInputModeTests`, `AnamneseStorageFormatTests`, `AnamneseStepToggleTests` | ids, input modes, stored format, step toggle | kept | ids/names/inputMode/pattern and the helpers unchanged     |
| `AnamneseFigmaTests` (new)                         | computed style + geometry of the measured values            | added         | Complements the masked pixel diff                                |
| `AnamneseCancelTests` (new)                        | restart; locked while saving; one PUT per tap; failed load locks Weiter until retry; 404 = empty form; save error above the footer | added | Review findings #2, #5 |
| `CssVariablesTests` `--qc-slate-500`, `--qc-indigo-800` | tokens resolve to their specified values               | added         | New tokens for chip stroke/text and selected chip text           |

`AnamneseMock` answers **every** `/api/*` call in the browser (config with a fake token, cards, resolve, appointment, anamnese GET/PUT, waiting room). A catch-all route aborts anything unmocked and records it, and every new test asserts that list is empty. No `FetchAsync` / `ContinueAsync`; `E2EFixture.BaseUrl` is used only to load the SPA's static files.

## Open — not proven

- the masked pixel diff against `03-anamnese.png` / `03-anamnese-lang.png`
- the E2E run of the tests above (they compile: `rollback/03-evidence.md`)
- the live URL `http://localhost:4711/qcheckin/default/` (needs a QService rebuild and a real card read)

No browser, Vite server, QService or database was used while making this change.
