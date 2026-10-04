# The lesson format (`warqa.lesson/1`)

A lesson is JSON validated by a Zod schema (`packages/lesson/src/schema`). Models write it; the player renders it. Nothing in it is code or a pixel position.

```jsonc
{
  "schema": "warqa.lesson/1",
  "id": "ch05", "title": "Subtracting positive and negative numbers", "number": 5, "unit": "Unit 2",
  "lang": "en",                       // language of the inline text
  "beats": [ /* … */ ]
}
```

## Beats

```jsonc
{
  "id": "rule", "title": "Add the opposite", "move": "transform",
  "narration": "Here's the rule. [[r]]Subtracting a number is the same as adding its opposite. [[keep]]Keep the seven.",
  "scene": { "clear": true, "keep": ["nl"], "remove": [], "add": [ /* nodes */ ] },
  "cues": [ { "at": "keep", "do": "highlight", "target": "eq1#tok:0", "args": { "color": "good" } } ],
  "questions": [ /* optional */ ], "card": { "place": "band", "label": "check" },
  "sources": [ { "page": 42 } ]
}
```

- **move** — the teaching move: `intro`, `hook`, `define`, `example`, `transform`, `contrast`, `predict`, `check`, `practice`, `summary`, `story`, `finish`.
- **narration** — what is said. `[[name]]` goes right before the word an action waits for. Narration never contains `$…$`; math is said in words.
- **speak** (optional) — the text sent to speech synthesis (numbers spelled out, diacritics), with the same marks.
- **scene** — `clear` fades the previous picture (except `keep` nodes, whose marks are cleared); `remove` fades nodes; `add` adds nodes. Node ids are unique in the lesson.
- **cues** — `at` is a mark, `{ "mark": "keep", "offset": 0.3 }`, `"start"`, `"end"`, or seconds. `do` is a generic action (`show hide highlight unhighlight pulse draw dim undim color`) or a component action (`step`, `hop`, `dot`, `set`, `brace`, `fill`, `tilt`…). `target` is a node id or `node#part`.
- Nodes appear automatically at the beat start unless a cue shows them (or `"enter": "cue"`); list items, flow steps, timeline events appear one by one unless cued. If a new picture would stay empty for 0.8 s, the opening is brought forward (the lead-in rule, from Papermorph).

## Nodes and slots

`{"id", "type", "slot"?, "enter"?, ...props}`. Slots: `title`, `upper`, `lower`, `main`, `start`, `end`, `band`, `full`. `start`/`end` mirror in right-to-left languages. Nodes in a wide slot sit side by side (in reading order); in a tall slot they stack. A node that doesn't fit is scaled down (QA reports it below 80 %). See [components.md](components.md) for every component.

## Questions

Kinds: `choice`, `blanks`, `numeric`, `grid` (true/false or categories), `order`, `pick` (click a tick, a token, an item…), `text`. Every question has `id`, `prompt`, optional `hint`, `explain`, and `resolve` cues that show the answer on the picture. Number answers are exact: `"-7"`, `"3/4"`, `"2 1/4"`, `"0.75"`; equal values match unless `{"value": "3/4", "lowest": true}`; `{"value": 3.14, "tol": 0.01}` accepts approximations; `{"text": ["…"]}` accepts words (case, accents, Arabic letter variants and diacritics ignored). Readers may type ٠-٩ or ۰-۹ digits, `٫` or a decimal comma.

The **first try** of each question is scored and kept across revisits; the finish card shows quick checks and practice separately.

## Inline math

Any text field may contain `$…$`: it is shown left to right in the math font, isolated from the surrounding text (so it reads correctly inside Arabic). `\$` is a literal dollar sign.

## Languages

`collectStrings(lesson)` lists every localizable string with a stable key (`beat.rule.narration`, `node.eq1.steps.0.0.note`, `q.c-sub.rows.0.template`…). `strings.<lang>.json` maps keys to translations (or `{ "text", "speak" }`). `checkStrings` verifies that every key is present, narration marks and answer boxes are the same, and `$` is balanced. Beat and question ids are shared, so progress and scores survive a language switch.

## Timings

`timings.<lang>.json`: per beat `{ dur, marks: { name: seconds }, captions: [[seconds, sentence], …] }`. Without audio, synthetic timings are computed from a reading speed per language, and the lesson still plays.

## Compilation

`compileLesson(lesson, timings)` folds the scene beat by beat as plain data and turns cues into channel segments. Any moment of any beat can be evaluated directly (`sampler(beat, t)`), so seeking is instant and identical to playing through — a property the tests check.
