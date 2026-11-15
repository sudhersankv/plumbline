# Plumbline console — design

## Discovery
- **Artifact:** SaaS application. Two areas: a compliance workspace (reviewers at a health plan) and a platform area (engineers).
- **Audience and job:** a reviewer must check a model's finding against the source text in seconds and sign it; an engineer must see cost, quality and routing at a glance.
- **Reference:** readily.ai (transposed, not cloned): warm paper neutrals, near-black ink, a light serif for display, square geometry, hairline rules.
- **Adjectives:** exact, calm, defensible, editorial. **Essence:** "ledger, not dashboard".

## Aesthetic and signature move
Editorial ledger: paper-white surface, a warm dust band for navigation, thin 1px rules instead of cards and shadows, square corners. Headlines in a light serif; everything operational in a grotesk; IDs in mono.

**Signature move: citation chips.** Every paragraph ID (`SUNVALE-POL-02:P12`) is a mono chip with a mint underline. Clicking it opens the exact paragraph beside the requirement. The product's promise (every flag traceable) is the most visible element on the page.

## Typography
- Display: **Fraunces** 300 (fallback Georgia). Used for page titles and big numbers only.
- Body/UI: **Special Gothic** (fallback Instrument Sans, then sans-serif).
- Mono: **IBM Plex Mono** for IDs, model names, numbers in tables.
- Scale 1.25 from 14px: 12 · 14 · 17.5 · 22 · 27 · 34 · 43 (display only).

## Color (OKLCH-equivalent hex kept from reference)
| Role | Value |
|---|---|
| bg | #ffffff |
| surface (nav band, selected rows) | #f4f1ed |
| dust (rules on surface) | #e9e5e0 |
| fg | #030303 |
| muted | #58534d |
| faint | #79736b |
| border | #e2ddd6 |
| accent (primary action) | #ffe27f pollen, text #030303 |
| mint (citation underline, verified) | #8eeba5 / tint #c6f4d2 |
| meadow (met / satisfied) | #2a8a6e |
| amber (partial / gap) | #b7790f, tint #fff3c6 |
| clay (conflict / missing / false-positive) | #b4462b, tint #f8e1d9 |
| teal (links) | #17605c |

60-30-10: white/ink, dust neutrals, pollen + semantic accents. Status is never color-only: every badge carries its word.

## Tokens
Spacing base 4px (4 · 8 · 12 · 16 · 24 · 32 · 48 · 64). Radius: 0 everywhere, 2px on chips. Shadows: none; elevation by surface tone and 1px rules. Motion: 120ms ease-out on hover/background only; respects `prefers-reduced-motion`.

## Craft decisions
- **Layout:** fixed left rail (dust band) with the two areas as labelled groups; content on a 12-col grid, max 1280px, left-aligned (not centered). Review pages are a two-pane split: list on the left, a side-by-side regulation | policy reader on the right.
- **Components:** buttons ranked primary (pollen fill), secondary (ink outline), quiet (text). Tables: left-aligned text, right-aligned tabular-nums numbers, 1px row rules. Full states: hover, focus-visible (2px ink outline, 2px offset), disabled, loading ("Running…" with elapsed seconds), empty and error states written as sentences.
- **Charts:** hand-drawn SVG: cost (log) vs accuracy scatter, calibration reliability plot. Direct labels instead of legends.
- **Iconography:** none beyond typographic glyphs (→, ·); words over icons.
- **Dark mode:** out of scope for the demo.
- **Accessibility:** WCAG AA contrast on all text (pollen used only behind ink text), 32px min targets, keyboard-reachable chips and rows.

## Slop audit (v1)
No indigo, no gradients, no rounded cards, no shadows, no icon tiles. Primary face is not Inter. Structure is a two-pane review tool rather than a KPI-card grid. Pass.

## Changelog
- v1 (2026-11-14): initial system.
