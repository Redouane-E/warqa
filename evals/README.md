# Evaluations

How well does each model make Warqa lessons? `run.mts` builds the same chapter of the same PDF with every model you list (each model plays every role except, optionally, `vision`) and records:

| metric | meaning |
| --- | --- |
| valid | the finished lesson has no validation errors |
| calls / repairs | model calls, and how many were rejected and sent back for repair |
| errors / warnings | `validateLesson` with pacing and source checks |
| QA issues | headless render checks (blank openings, overlaps, overflow, page errors) per language |
| cost / time | from the cost ledger |

```bash
pnpm --filter @warqa/evals eval -- --pdf ../packages/pipeline/test-fixtures/textbook-ar.pdf \
  --models anthropic:claude-sonnet-5-5,google:gemini-3.8-flash,deepseek:deepseek-v4-flash,ollama:qwen3:14b \
  --langs ar,fr --chapter ch01
```

Results go to `results/` and `LEADERBOARD.md`. Use openly licensed fixtures (CC-BY or public domain) so results can be shared. Teaching quality still needs people: pair these numbers with a teacher panel's ratings of the generated chapters.

## Teacher panel

Numbers say whether a lesson is valid and cheap; only teachers can say whether it teaches well. Run the
models with `--panel ../panel-kit` to also export a **blind kit**: each model's chapter becomes a letter (A, B,
C…), and the key goes to `panel-kit-key.json` beside the folder. Keep the key to yourself.

1. Send the kit folder (zipped, or on a web server) to teachers. Each lesson has a ★ button (key R). Teachers
   rate each step from 1 to 5 on five criteria: correct, clear, picture supports the words, language, level.
   They then rate the whole lesson, including "would you use it in class?".
2. Each teacher clicks **Download my ratings** and sends you the file. It works offline; nothing is uploaded
   anywhere.
3. Score the panel and add it to the leaderboard:

```bash
pnpm warqa panel results ratings/*.json --key panel-kit-key.json --leaderboard evals/LEADERBOARD.md
```

To make a kit from books you already have, use `warqa panel kit book-a.warqa book-b.warqa --chapter ch01`.
Add `?panel` to any lesson's address to rate it on the spot.

