# Arabic in Warqa

Warqa was designed for Arabic (Modern Standard Arabic) from the start, alongside French and English.

## Reading Arabic PDFs

Arabic PDFs often have broken text layers. `warqa ingest` scores every page with `arabicTextQuality` and:

- **presentation forms** (glyph code points U+FB50–FDFF, U+FE70–FEFF) → normalized back to letters (only those ranges, so `²`, `½` stay);
- **visually ordered (reversed) lines** → repaired word by word;
- **missing ToUnicode maps** (private-use characters, `(cid:…)`, U+FFFD) and **scanned pages** → OCR with your `vision` model (Gemini models are among the best at Arabic OCR) or the worker (Tesseract `ara`).

## Writing Arabic lessons

Prompts ask the models for clear Modern Standard Arabic, Moroccan textbook terminology where it exists (المستقيم المدرج، مقابل العدد، موجب/سالب…), and:

- **math in Latin notation, left to right, between `$…$`** even inside Arabic text: «حل المعادلة $2x + 3 = 7$»;
- **Western digits (0–9)** by default (the Moroccan convention; `"digits": "arab"` in warqa.json shows ٠–٩);
- **numbers and math in words in the narration** («سبعة ناقص ثلاثة») because narration is spoken.

## Right-to-left layout

- `start`/`end` slots, rows of nodes, lists, cards, timelines, flows, concept maps, counters and bar charts follow the reading direction.
- Number lines, coordinate planes, equations and fraction bars keep their mathematical orientation.
- Navigation mirrors: ← is "next" in Arabic; the back/next icons flip; the progress bar fills from the right.
- Keyboard shortcuts use physical keys (`e.code`), so they work on Arabic keyboard layouts; `؟` opens the help.
- Arabic text is never split per letter (that would break joining); reveals are by whole element.

## Answers

Readers can type `٧`, `۷` or `7`, `٫` or `,` for decimals, and fractions. Word answers ignore diacritics, tatweel, alef variants (أ إ آ ٱ → ا), ى/ي and ة/ه.

## Narration and voices

- Edge / Azure voices: `ar-MA-MounaNeural`, `ar-MA-JamalNeural` (Moroccan), `ar-SA-*`, `ar-EG-*`… Edge reports Arabic word boundaries, so marks are exact.
- Marks inside words with attached prefixes («و[[m]]مقابل») are aligned to the word.
- Optional **tashkeel** before synthesis (`"tts": { "tashkeel": true }` + the worker with CATT): accepted only if removing the diacritics gives back exactly the original letters.
- Read-along: every word has a time, so picture books and captions highlight the word being read, in Arabic as in any language.

## Darija (الدارجة)

Darija is a book language of its own: `ary`. Add it like any language (`warqa init … --langs ar,ary,fr`, or
`warqa translate --to ary`).

- **Writing:** the model writes Moroccan Darija the way a teacher explains in class, in Arabic script only
  (never Latin-script "Arabizi"). It keeps the school terms of Moroccan textbooks in standard Arabic and says
  math in words in the narration.
- **Interface:** the player's buttons and messages are in Darija («بدا الدرس»، «عاود شوف»), with right-to-left
  layout, Western digits and decimal commas like Arabic.
- **Voices:** Edge and Azure read Darija with the Moroccan Arabic voice `ar-MA-JamalNeural`. The Python
  worker can use the open Habibi-TTS Moroccan model (`habibi-MAR`). Check its licence before publishing: the
  model card and the Hugging Face metadata disagree (Apache-2.0 vs CC-BY-NC-SA), and the F5-TTS base weights
  are non-commercial.
- **Example:** `examples/fox.warqa` (the picture book) has a Darija version.

Darija spelling varies. Review the translations with `warqa review --lang ary` (see
[translation.md](translation.md)): wording a teacher approves is reused in every later chapter.

## Translation

Any language to any language. A French or English PDF can become an Arabic book: the lesson is written in the book's main language and translated key by key, keeping marks, answer boxes and math; the glossary keeps terminology consistent.
