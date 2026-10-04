# Quality: checks, the vision judge and teacher panels

Warqa checks lessons at three levels: rules it can verify by itself, a vision model that looks at the
pictures, and people.

## 1. Automatic checks

- **While writing:** each beat is validated as soon as the model writes it, and problems go back to the model
  to fix (up to three times). The validator checks:
  - the schema, cue targets and marks
  - pacing (a visual change per sentence, no empty openings)
  - layout (nothing too wide, too tall or overlapping, judged against what is on screen at the same time)
  - math that does not typeset
- **`warqa validate`:** the same checks on any book, plus translations (marks, answer boxes, formulas).
- **`warqa qa --shots`:** renders every beat headlessly and reports blank openings, overlaps, text that had to
  shrink, things off the stage, and page errors. It writes screenshots and contact sheets to
  `qa/<lesson>/<lang>/`.

## 2. The vision judge, in the loop

```bash
warqa qa --judge                 # report: a vision model scores each beat from its picture and narration
warqa improve --chapter ch02     # judge, rewrite the weak beats with the judge's notes, judge again
```

`improve` renders every beat and shows the vision model (role `judge`) the picture with its narration. The
model scores the beat from 1 to 5 and says what is wrong and how to fix it. Every beat below the threshold
(`--threshold`, default 4) is rewritten with those notes as the instruction. The other beats, and the nodes
later beats depend on, are kept. Then the judge looks again and you get the scores before and after.
`--rounds 2` repeats the loop.

Rewritten beats lose their translations and audio, so run `warqa translate` and `warqa narrate` afterwards.
Unchanged sentences come back from the translation memory.

The judge costs one vision call per 4 beats per round. Check `warqa estimate`, and set a budget in
`warqa.json`.

## 3. Teacher panels

Only teachers can say whether a lesson teaches well. Warqa has everything needed to ask them.

**Rating mode.** Add `?panel` to any lesson's address (or export a kit, below): a ★ button (key **R**) opens a
form to rate the current step from 1 to 5 on five criteria:

- the content is correct
- the explanation is clear
- the picture supports the words
- the language is good
- the level suits the pupils

The form also has an optional comment and questions about the whole lesson (overall quality; "would you use it
in class?"). Ratings stay in the browser and work offline. **Download my ratings** saves them as a small JSON
file.

**A blind kit.** To compare models (or versions) fairly:

```bash
warqa panel kit book-model-a.warqa book-model-b.warqa --chapter ch01 --out panel-kit
```

Each lesson becomes a letter (A, B, …), in random order, and the key goes to `panel-kit-key.json` beside the
kit. Keep the key; send the kit (zipped, or on any web server) to the teachers with the instructions on its
first page (in Arabic, French and English).

**Results.**

```bash
warqa panel results ratings/*.json --key panel-kit-key.json --leaderboard evals/LEADERBOARD.md
```

This shows the mean score per model and criterion, the number of raters and steps, and the "would use"
answers. It adds the table to the leaderboard next to the automatic metrics. `evals/run.mts --panel <dir>`
builds the kit straight from a model comparison run (see [evals/README.md](../../evals/README.md)).
