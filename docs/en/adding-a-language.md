# Adding a language

Warqa can already **write and translate lessons into any language**: lesson languages are BCP 47 tags
(`es`, `tr`, `ary`…), translation works key by key, the writing direction comes from the tag, and lessons
without audio get synthetic timings. What this guide adds is **first-class support**: the interface of the
player and the studio, writing rules for the models, voices, number formats and PDF reading.

You do not have to do everything at once. A pull request with only the player catalog (step 1) is already
very welcome. Open a "New language" issue first so others can help and review.

| Step | Files | Needed for |
| --- | --- | --- |
| 1. Player interface | `packages/i18n/src/catalog/<lang>.ts`, `catalog.ts`, `lang.ts` | learners see buttons, questions and help in their language |
| 2. Studio interface | `apps/studio/src/client/messages.ts`, `i18n.ts` | book makers use the studio in their language |
| 3. Writing rules | `packages/pipeline/src/prompts/index.ts` | models write natural lessons for this audience |
| 4. Voices | `packages/pipeline/src/tts/providers.ts` | narration has a good default voice |
| 5. Reading PDFs | `packages/pipeline/src/ingest/classify.ts` | `ingest` finds chapters in textbooks in this language |
| 6. Numbers and text | `packages/i18n/src/numbers.ts`, `text.ts`, `arabic.ts` | answers typed with local digits; sentences split right |
| 7. Docs | `docs/<lang>/` | people can get started |

## 1. Player interface

The player's messages are in `packages/i18n/src/catalog/` (about 90 keys).

1. Copy `en.ts` to `<lang>.ts` (for example `es.ts`) and export a `Catalog`:

   ```ts
   import type { Catalog } from '../catalog.js';

   export const es: Catalog = {
     'lesson.aria': 'Animación de la lección',
     // …every key of en.ts
   };
   ```

2. Translate every value. Keep `{placeholders}` exactly (`{n}`, `{min}`, `{title}`). Write for learners:
   short, warm, the words used in schools of the countries that will use it.
3. **Plurals**: a message can be an object of plural forms. Use the categories your language really has:

   ```bash
   node -p "new Intl.PluralRules('es').resolvedOptions().pluralCategories"   # [ 'one', 'many', 'other' ]
   ```

   Arabic uses all six (`zero`, `one`, `two`, `few`, `many`, `other`); `other` is always required.
4. Register the catalog in `packages/i18n/src/catalog.ts` (import it and add it to `CATALOGS`).
5. Add the language to `LANGS` and `LANG_INFO` in `packages/i18n/src/lang.ts`:

   ```ts
   es: { name: 'Español', dir: 'ltr', locale: 'es-ES', cps: 15 },
   ```

   - `name`: the language's own name, for language pickers;
   - `dir`: `rtl` or `ltr` (if the language is right to left and its subtag is not yet in the `RTL` set, add it);
   - `locale`: the `Intl` locale for numbers (choose the regional variant your audience uses);
   - `cps`: speaking rate in characters per second, used for timings when a lesson has no audio
     (13 for Arabic, 15 for French and English; time a few spoken sentences to estimate it).

   TypeScript then points at every `Record<Lang, …>` that needs an entry.

   **Lighter path — a book language without a studio interface.** `LANGS` lists the studio's interface
   languages. A language that only needs a player interface and writing rules goes in `EXTRA_LANG_INFO` and
   `CONTENT_LANGS` instead, as Darija (`ary`) does. Arabic varieties also go in `ARABIC_VARIETIES`, so that
   they share Arabic text processing and fall back to Arabic voices.
6. Run `pnpm --filter @warqa/i18n test`: it checks that every catalog defines every key.

## 2. Studio interface

The studio has its own messages (about 320 keys) in `apps/studio/src/client/messages.ts`:

1. Add `export const es: Record<MsgKey, Msg> = { … }` with every key of `en` (TypeScript reports missing
   keys), and add it to `CATALOGS` at the end of the file.
2. In `apps/studio/src/client/i18n.ts`, add the code to the `UiLang` type and to `UI_LANGS`.
3. `pnpm --filter @warqa/studio typecheck && pnpm --filter @warqa/studio test`, then try it:
   `pnpm warqa studio examples` and switch the interface language.

The browser-only web app (`apps/web`) may have its own catalog; follow its README.

## 3. Writing rules for the models

`packages/pipeline/src/prompts/index.ts`:

- `langName()` — the name models read ("Modern Standard Arabic (العربية الفصحى)", "French"). Be precise
  about the variety (e.g. "European Portuguese", "Brazilian Portuguese").
- `languageRules()` — add a branch for your language. Look at the Arabic and French rules: register and
  tone, the vocabulary of local textbooks, how math is written on screen (decimal separator, minus sign),
  and **how math is said in narration** with two or three examples ("siete menos tres", "x al cuadrado").

Then build a chapter in that language with a couple of models and read it with a teacher. Prompt changes
are teaching changes: describe what you checked in the pull request.

## 4. Voices

`packages/pipeline/src/tts/providers.ts`:

- `EDGE_VOICES` — the default Microsoft Edge/Azure voice per language (list them with
  `uvx edge-tts --list-voices`). Prefer a regional voice your audience knows.
- The Google engine's `defaultVoice` map, if it has voices for the language.
- Note in [voices.md](voices.md) which engines give word timings for this language.

Users can always choose another voice per language in the studio (*Settings → Speech*) or in
`warqa.json` (`pipeline.tts.voices`).

## 5. Reading PDFs

`packages/pipeline/src/ingest/classify.ts` finds chapters from headings when a PDF has no bookmarks:

- add the words for "chapter", "lesson", "unit", "part"… to `CHAPTER_WORDS` and `UNIT_WORDS`, and ordinal
  words to `ORDINALS`;
- `detectLang()` only tells Arabic, French and English apart; if your language needs to be recognised in
  mixed documents, extend it with a stopword list like `FR_WORDS`;
- add a unit test in `packages/pipeline/src/ingest/ingest.test.ts` with real heading lines.

## 6. Numbers and text

- `packages/i18n/src/numbers.ts`: `normalizeDigits()` turns Arabic-Indic (٠–٩), Persian/Urdu (۰–۹),
  Devanagari and full-width digits into ASCII before parsing answers (`DIGIT_BLOCKS`). Add other digit
  systems your learners type, and check decimal and thousands separators.
- `packages/i18n/src/text.ts`: `splitSentences()` ends sentences on `. ? ! ؟ ؛ … ۔`. Add your language's
  sentence punctuation if it is missing (e.g. `।` or `。`).
- `packages/i18n/src/arabic.ts`: letter normalization for matching word answers in Arabic script; a
  similar helper may help other scripts (accents, letter variants).
- Add tests to `packages/i18n/src/i18n.test.ts`.

## 7. Docs

Add `docs/<lang>/README.md` and `docs/<lang>/start-here.md` (copy the English or French ones and adapt
them: the steps should name the buttons as they appear in the translated studio). Ask a maintainer to link
them from the main README.

## See it working

The example book has Arabic, French and English only. To see the player in your language, work on a copy:

```bash
cp -R examples/integers.warqa /tmp/integers-es.warqa
pnpm warqa translate /tmp/integers-es.warqa --to es     # needs one model key; adds es to the book's languages
pnpm warqa narrate /tmp/integers-es.warqa --lang es     # optional
pnpm warqa preview /tmp/integers-es.warqa               # then choose the language in the player
```

Do not commit the translated example unless a native speaker has reviewed it; if you do, it must stay
under the example's licence (see `THIRD_PARTY_NOTICES.md`).

## Checklist

- [ ] Player catalog complete, registered, `LANG_INFO` filled in; `pnpm --filter @warqa/i18n test` passes
- [ ] Studio catalog complete (if included) and checked in the browser
- [ ] Plural forms checked with `Intl.PluralRules`
- [ ] Right-to-left checked if the language is RTL (layout, navigation arrows, number lines unchanged)
- [ ] Writing rules, voices and headings (if included) tried on a real chapter
- [ ] Screenshots of the player (and studio) in the new language in the pull request
