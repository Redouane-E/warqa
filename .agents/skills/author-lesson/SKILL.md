---
name: author-lesson
description: Write or edit a Warqa lesson by hand (lesson.json beats, narration with [[marks]], scene nodes, cues, questions) and its translations, then validate, narrate with free voices and render it. Use for example books under examples/, test fixtures, or when asked to make or fix a lesson without spending model credits.
---

# Author a lesson by hand

Reference: `docs/en/lesson-format.md` and `docs/en/components.md`. Good models to copy:
`examples/integers.warqa/lessons/ch05/lesson.json` (maths), `examples/fox.warqa` (picture book),
`examples/morocco.warqa` (maps and a pick question).

1. **The structure.** A book is a folder with `warqa.json`, and `lessons/<id>/lesson.json` in the author
   language. The usual beat order:
   - an `intro` (a title card)
   - lesson beats, one idea each, with a quick `check` every 2–3 beats
   - a `summary` (a list)
   - 1–3 `practice` sets
   - a `finish` beat
2. **Narration** says, in words, what the picture shows. Put `[[mark]]` before the words a cue waits for.
   Never write symbols or digits for math in narration: it is read aloud.
3. **Scene and cues:**
   - Nodes persist between beats unless `clear`, `remove` or `keep` say otherwise.
   - Cues `{at, do, target}` target nodes or parts (`"eq#tok:1"`, `"m#r:2"`). Use one visual change per
     sentence, and nothing empty at the start.
4. **Questions:** the kinds are choice, blanks, numeric, grid, order, pick and text. Give `explain`, give
   `why` for wrong options, and use `resolve` cues to show the answer in the picture.
5. **Validate:** `pnpm warqa validate <book>` prints errors with fix-it messages. Fix them all; read the
   warnings.
6. **Translations:** `strings.<lang>.json` maps keys to text. List the keys with `collectStrings` from
   `@warqa/lesson`, or use the MCP tool `warqa_strings`. Keep every `[[mark]]`, `[[box]]` and `$math$`.
   Write the translations yourself; do not call `warqa translate` without asking, because it spends credits.
7. **Voices:** `pnpm warqa narrate <book>` with the free Edge provider (`"tts": {"provider": "edge"}`; needs
   uv). It stores audio and word times.
8. **Look at it:** `pnpm warqa qa <book> --shots`, then read the contact sheets (the `visual-qa` skill).
9. Examples are exported by `e2e/global-setup.ts` and by the Pages workflow: run `pnpm e2e` after changing
   one.
