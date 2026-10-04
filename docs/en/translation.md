# Translation, glossary and review

Warqa translates a lesson's **string table**, not the lesson: narration, titles, labels, questions and
feedback, key by key. The structure (scenes, cues, answers) is shared by every language. A translation must
keep every narration mark (`[[keep]]`), every answer box and every formula, or it is sent back to the model.

```bash
warqa translate --to ar                 # every chapter
warqa translate --to ary --chapter ch02 # Darija, one chapter
```

## The book's translation memory

Each language pair has a memory for the whole book (`tm/<from>-<to>.json`). Three things happen on every
`translate`:

- **Reuse:** a sentence the book already translated is taken from the memory, not asked again. Repeated
  sentences across chapters ("Quick check.", "Add the opposite.") always read the same, and cost nothing.
- **Consistency:** for the new sentences, the model sees how the book translated similar sentences before (the
  closest ones, teacher-checked wording first), and keeps that wording.
- **People win:** wording a person approved or edited is never replaced by the model, not even with
  `--force`.

`--force` re-translates only machine-made strings.

## Glossary

The plan has a glossary: each key term in every book language (`plan.json` → `glossary`). The model sees it
when writing and translating. After translating, Warqa checks every string that uses a source term: if the
translation does not use the agreed term, it is reported, e.g. `glossary: “opposite” should be “مقابل”`.
Arabic matching ignores the article and attached letters (العدد = عدد), and French and English ones ignore
endings.

## Review

Every string of a language is in one of five states:

| state | meaning |
|---|---|
| machine | translated by a model, not checked yet |
| approved | a person checked it and kept it |
| edited | a person changed it |
| stale | it was checked, but the source sentence changed since |
| missing | not translated yet |

```bash
warqa review --lang ar                       # counts per state, and the strings with problems
warqa review --lang ar --approve all         # approve every machine translation as it is
warqa review --lang ar --approve ch01/beat.intro.title
```

### With a spreadsheet

Teachers often prefer a spreadsheet:

```bash
warqa review --lang ar --export review-ar.csv
```

The file opens in Excel, LibreOffice or Google Sheets; Arabic shows correctly. Its columns are: lesson, key,
where, state, problems, source, translation, ok.

1. Correct the **translation** column where needed.
2. Put "yes" in **ok** for rows that are right as they are. Any of yes / oui / نعم / x / ✓ works.

Then load it back:

```bash
warqa review --lang ar --import review-ar.csv
```

Changed rows become "edited" and rows marked ok become "approved". A change that would break a narration mark
or an answer box is refused and listed. Comma- and semicolon-separated files both work.

### In the studio

**Review translations** (on the project page) shows the same list. You can filter by state or problem, edit
in place, approve one string or everything shown, and download or import the spreadsheet.

## After rewriting a beat

`warqa rewrite` and `warqa improve` change beats: the translations of a changed beat are removed, and
`warqa translate` then redoes just those strings (unchanged sentences come back from the memory).
