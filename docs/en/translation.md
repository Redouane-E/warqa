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
| stale | the source sentence changed since it was translated or checked ("Original changed") |
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

A model translation whose source changed is translated again by the next `warqa translate`. A person's
wording is never translated over: it stays "stale" until they keep it or ask for a new translation.

### In the studio

Step 4 of a book, **Translate & narrate**, shows every language as a card: the original, and for each
translation how much is translated and how much a person checked, its voice (with a sample) and whether it is
narrated ("2 beats changed since" when a beat's text or voice changed after its recording). A language not
translated yet has its **Translate** button, with what it costs beside it.

Under the cards, **Review the …** lists one language's texts beside their originals, the book's or one
chapter's:

- Marks (`[[keep]]`), answer boxes and `$math$` are drawn locked. If a translation loses a mark, it says
  where it goes, and **Put … back** puts it there. Approving waits until marks, answer boxes and `$` match.
- The glossary term a sentence should use is shown under it; a translation that ignores it is flagged.
- **Original changed** shows what changed ("−5 became −7"). **Keep mine** keeps the translation; **Translate
  again** asks the model for that sentence only.
- **Approve the … strings shown** approves the model's translations on screen; the toast has Undo.
- **Download spreadsheet** (the whole book or the chosen chapter) and **Import reviewed spreadsheet**, which
  first lists what the file will change, then **Apply**.

Each lesson folder keeps what its translations and recordings were made from (`sources.<lang>.json`,
`narrated.<lang>.json`), so "Original changed" and "changed since" survive a restart and go with the book.

## After rewriting a beat

`warqa rewrite` and `warqa improve` change beats: the translations of a changed beat are removed, and
`warqa translate` then redoes just those strings (unchanged sentences come back from the memory).
