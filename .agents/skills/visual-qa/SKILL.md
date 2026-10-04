---
name: visual-qa
description: Render Warqa lessons (or the studio / web app) and look at the result in Arabic and a left-to-right language — contact sheets, overlaps, empty openings, RTL mirroring, phone width. Use after changing anything visible - player views, components, styles, layout, the studio or web UI, or an example book.
---

# Look at the result

Unit tests do not see overlaps, cut text or wrong mirroring. Look at the pictures.

## Lessons and components

1. Rebuild the player bundle if `packages/lesson` changed: `pnpm --filter @warqa/lesson build`, then the CLI:
   `npx turbo run build --filter=@warqa/cli`.
2. Pick a book that uses what you changed:
   - `examples/integers.warqa` (maths)
   - `examples/fox.warqa` (picture book, read-along, Darija)
   - `examples/morocco.warqa` (maps)
   - a new component: add it to the component gallery (`packages/lesson/src/core/gallery.ts` uses every
     component's `examples`) and check it in `e2e/.site/gallery/` after `pnpm e2e`.
3. Render and check: `pnpm warqa qa <book> --shots --lang ar,en`. It prints issues (blank openings,
   overlaps, overflow, off-stage, errors) and writes `qa/<lesson>/<lang>/sheet_*.png` and `b??_end.png`.
4. **Read the images** (they are PNG files) and check:
   - Arabic is right to left: slots mirrored, text right-aligned. Number lines, planes, maps and math are
     *not* mirrored.
   - Nothing overlaps or is cut, and labels are readable.
   - The picture changes on the words that explain it, with no empty opening.
5. To see a moment in a real browser, open the exported page and call `window.warqa.freeze(beatIndex, seconds)`
   from Playwright, then screenshot `.wq-frame`.

## Studio and web app

- Studio: `pnpm studio` (books in `./books`) or `pnpm warqa studio examples`.
- Web app: `pnpm --filter @warqa/web dev`. The test model needs no key: add `?warqa-fake=1`.
- Screenshot each screen you changed in Arabic and English, at 1280×800 and at 390 px wide (no sideways
  scrolling, nothing cut), and look at the screenshots.

Report what you looked at and what you fixed. Leave the screenshots out of commits (`qa/` is ignored).
