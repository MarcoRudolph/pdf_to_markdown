---
description: "Provenance, intended deviations and test contract for the Figma redesign of the QCheckIn Bestätigung step (frame 8:413, Countdown set 31:764)"
summary: "Renders 06-*.png from Figma NW1VqaB6ud5AGCCLOlWnW3 (lastModified 2026-10-27T08:21:59Z), read via REST after the account joined the doctorly team (Dev seat). Check icon is the exported SVG of 8:419. Built on StatusScreen with a new success tone (--qc-success-bg #ECFDF5). Countdown now 30 s (Figma set Seconds=30..1, was 15). Header fixed to px classes and an inset hairline: 64px (84 with progress) instead of ~73 (~96), which moves every step up by the difference. Not in Figma: pending = 22:834 waiting screen, 409 = sentence instead of number, 500 = 22:855 icon without button. Verified by static gate + mocked headless probe; E2E written and compiled, not run."
paths:
  - "./SOURCE-04.md"
  - "./06-bestaetigung.png"
  - "./06-countdown.png"
  - "./rollback/06-evidence.md"
  - "./rollback/06-new-files.txt"
  - "../../src/components/Wartezimmer.tsx"
  - "../../src/components/StatusScreen.tsx"
  - "../../src/components/Header.tsx"
---

# Figma source: QCheckIn Bestätigung (tab 5)

Same method as tabs 1–4 (`SOURCE.md` … `SOURCE-04.md`); only what differs or is new is listed here.

## Provenance

| Item         | Value                                                                                  |
|--------------|----------------------------------------------------------------------------------------|
| File         | `NW1VqaB6ud5AGCCLOlWnW3` ("Patient checkin")                                           |
| Frame        | 8:413 "5 · Bestätigung" (768×1024)                                                     |
| Components   | 6:504 Header (variant "Done"), 31:764 "Check-in / Countdown" (Seconds=30 … 1), button 6:60 |
| lastModified | 2026-10-27T08:21:59Z                                                                   |
| Export       | 2026-10-28, REST `/v1/files/.../nodes` (values) and `/v1/images` (PNG scale 1, SVG)    |
| Access       | The Figma MCP still refuses ("no edit access"); REST worked after the account joined the doctorly team (Dev seat). |

| Render                  | Node   | sha256                                                             |
|-------------------------|--------|--------------------------------------------------------------------|
| `06-bestaetigung.png`   | 8:413  | `4a0a93ce6abd7c72b5960a7b240f796c076a5d993f2f32cd680ad2d70f1c0491` |
| `06-countdown.png`      | 31:764 | `3a5969c25d7e808c47d30ec245e4ccfadf41e5fe98c1f39d5987955883587ca0` |

| Icon (src/assets/icons)          | Figma node | How it was made                                                    |
|----------------------------------|------------|--------------------------------------------------------------------|
| `icon-anmeldung-erfolgreich.svg` | 8:419      | `/v1/images` SVG export (sha256 of the raw export `07a0f957…`), the no-op 80×80 clipPath removed, paths and stroke unchanged |
| `icon-senden-fehlgeschlagen.svg` | 22:855     | reused from tab 4 for the error state                              |

## Values

| Node                   | Figma                                              | Code                                                       |
|------------------------|----------------------------------------------------|------------------------------------------------------------|
| Content 8:417          | vertical, gap 32, centred in 768×960 under header  | `StatusScreen` column (gap 32, centred in `main`)          |
| Illustration 8:418     | 150×150, r75, #ECFDF5                              | `tone="success"` → `bg-qc-success-bg` (`--qc-success-bg`)  |
| Icon 8:419             | 80×80, #10B981 stroke 3                            | exported SVG as `<img>`                                    |
| Title / body 8:422     | 24/32 600 #0E0E2C, 8, 16/20 400 #475569            | `qc-title` / `qc-subtitle`                                 |
| Waiting number 8:425   | 14/20 500 #475569, 4, 60/80 700 ls −1.2 #0E0E2C    | `qc-label text-qc-muted`, `text-[60px] leading-[80px] font-bold tracking-[-1.2px]` |
| Actions 8:428          | vertical, gap 16                                   | `gap-[16px]`                                               |
| Fertig 8:429           | filled, 90×38, pad 6/22, r12, 14/20 500            | `Button size="figma"` (44px target, 38px pill)             |
| Countdown 24:487       | 16/20 400 #475569, seconds 600 #0E0E2C, gap 4      | `<Trans>` with `<strong>` → `font-semibold text-qc-ink`    |

## Intended deviations

| # | Deviation                                                                 | Why                                                                                     |
|---|---------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| 1 | Inter instead of SF Pro                                                   | as tabs 1–4; text widths differ by ±4px                                                  |
| 2 | Countdown words joined by a normal space, not an auto-layout gap of 4px   | one translatable sentence per language keeps the word order (tr, ar put the number elsewhere); the space is ~4.5px |
| 3 | Fullscreen toggle in the header                                           | declared in principles.md                                                               |
| 4 | Pending state = 22:834 waiting screen ("Ihre Anmeldung wird gesendet")    | Figma has no frame; it continues the Zustimmung submit screen without a second spinner flash |
| 5 | No position (409 / no patient): "Sie werden aufgerufen …" in the number's slot, subtitle style | Figma has no frame                                              |
| 6 | Check-in failed: 22:855 icon, "Anmeldung konnte nicht abgeschlossen werden", "Bitte wenden Sie sich an den Empfang", no button, no countdown | Figma has no frame; staff must see it (unchanged behaviour) |

## Behaviour changes

- **Countdown 30 s instead of 15 s.** The Figma set 31:764 defines Seconds=30 down to 1. One constant: `RESTART_COUNTDOWN_SECONDS` in `Wartezimmer.tsx`.
- **Header 64px (84 with progress), on every step.** `Header.tsx` used rem classes (`h-16`, `pb-4`, `h-1`, …) at `html { font-size: 18px }`, plus a 1px border outside Figma's INSIDE stroke: about 73px without and 96px with progress (the latter from the tab-4 measurement). Now px classes and an inset hairline; measured 64px on this screen. Every step's content therefore sits higher by that difference, which is what Figma and the existing header tests (64 / 84) expect.
- `bestaetigung.pending` removed from all 7 locales (unused now). `bestaetigung.resetIn_*` carry `<strong>{{count}}</strong>`.
- `size="kiosk"` has no user left in `src` (Wartezimmer was the last). The variant stays in `button.tsx` because `ButtonHeightTests` documents it; remove both together if wanted.

## Test contract

| Test                                         | Change                                                                                  |
|----------------------------------------------|-----------------------------------------------------------------------------------------|
| `Wartezimmer/WartezimmerFigmaTests` (new)    | Fully mocked (AnamneseMock). Boxes and styles of 8:413 at 768×1024, countdown 30 → 12 → reset after 30 s. |
| `Wartezimmer/WartezimmerViewport/TapTargets/Interaction`, `Flow/FullCheckinFlowTests` | unchanged: `step3-success` / `step3-error` / `step3-ok` still exist (now on the screen root, not the h2) |
| `Header/HeaderViewportTests`                 | unchanged; its 64px assertion now matches the code                                      |

Not run: E2E needs the shared DB and permission. Verification so far: static gate + mocked headless probe (`rollback/06-evidence.md`).
