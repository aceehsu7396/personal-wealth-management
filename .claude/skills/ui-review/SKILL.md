---
name: ui-review
description: Review a page of this site against docs/ui-guidelines.md before it ships — laptop screenshots first (1366×768, 1440×900, light and dark), phone as a smoke check — and fix what fails. Use after building or changing any page, and when the user asks whether a page is simple and easy to read.
---

# UI review

Every new or changed page must pass this review before it is merged. The rules are in `docs/ui-guidelines.md`; read §9 (the checklist) before starting.

## Steps

1. **Build and serve** the site locally:
   ```bash
   npm run build && (npx vite preview --port 4173 --strictPort > /dev/null 2>&1 &)
   ```
2. **Run the automatic check** on the pages you changed (or all pages with no arguments). It loads the demo data first so pages are not empty:
   ```bash
   node scripts/ui-check.mjs /sim/strategies /portfolio --out <scratchpad>/ui-check
   ```
   It writes `report.md` and a first-screen screenshot per page and view: 筆電淺色 1366×768, 筆電深色 1440×900, 手機 390.
3. **Read the report.** Treat these as must-fix: console errors, horizontal overflow, a page title not on the first laptop screen, unnamed buttons or links, text under 12px, contrast failures on text you added, heading level skips.
4. **Look at the laptop screenshots** (Read the PNGs) and go through `docs/ui-guidelines.md` §9 item by item. The script cannot judge these, so check them yourself:
   - Does the first screen show the title, the one-line summary, the most important conclusion, and the main action?
   - One primary (solid indigo) button per page and per card?
   - Conclusion → reasons → details, with details collapsed?
   - Within the limits: ≤ 5–7 numbers per card, ≤ 4 tiles per row, tables show 10 rows then fold?
   - Short, plain Traditional Chinese sentences; terms explained with `Term`?
   - Advice in the three levels (`AdviceList`), each with its basis?
   - Shared components from `src/components/ui/` and the four tones only?
5. **Fix and re-run** until the must-fix list is empty and every §9 item holds, or record why an item is accepted.
6. **Report** in Traditional Chinese: pages checked, what was fixed, anything left and why. Phone results only need "no overflow, usable".

## Notes

- The browser comes from `CHROME_PATH` or the local Playwright cache (`~/Library/Caches/ms-playwright`).
- `--base` checks another address, e.g. the live site after deploy: `--base https://aceehsu7396.github.io/personal-wealth-management/#`.
- `--no-demo` checks the empty state a new user sees.
- The baseline of existing pages is in `docs/ui-baseline.md`; when you change one of those pages, fix its listed items too.
