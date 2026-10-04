---
name: ui-strings
description: Add or change interface text in Warqa in every language - the player catalogs (en, fr, ar, ary) and the studio messages (en, fr, ar) - with correct Arabic plurals, Darija and RTL. Use whenever a change adds a button, label, message or error that a user sees.
---

# Interface strings

Warqa has two interfaces with their own catalogs:

| Where | File | Languages |
|---|---|---|
| Player (books, exports) | `packages/i18n/src/catalog/{en,fr,ar,ary}.ts` | en, fr, ar, ary (Darija) |
| Studio and web app | `apps/studio/src/client/messages.ts` | en, fr, ar |

## Rules

- Add **every key to every language** in the same change. `MessageKey` comes from `en.ts`, and
  `pnpm --filter @warqa/i18n test` fails when a catalog misses a key. TypeScript catches missing studio keys.
- Write real text in each language, for teachers and pupils:
  - **French:** classroom vocabulary.
  - **Arabic:** clear Modern Standard Arabic, Moroccan school terms.
  - **Darija:** Arabic script as spoken in Morocco («بدا»، «عاود»، «ديال»). Never Latin-script Arabizi.
- Keep placeholders exactly (`{n}`, `{title}`). Numbers in placeholders are formatted for the language.
- **Plurals:** a message can be an object of plural forms. Arabic and Darija use `zero`, `one`, `two`,
  `few`, `many` and `other`; French and English use `one` and `other`. Look at `book.chapters`.
- Do not build sentences by concatenating pieces: word order differs between languages.
- In the UI, Arabic-script text may sit next to Latin text: give such elements `dir="auto"`, and check RTL
  layout with the `visual-qa` skill.
- After changing `packages/i18n`, rebuild it (`npx turbo run build --filter=@warqa/i18n`) before testing
  the player or the apps.
