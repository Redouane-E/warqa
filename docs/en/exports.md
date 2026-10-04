# Exports

| command | result |
| --- | --- |
| `warqa export` | `dist/`: a static site — `index.html` (cover + contents) and one folder per lesson. Works on any web server **and from `file://`** (the lesson data is inlined; fonts and the player are bundled). It is also an installable **offline web app** (manifest + service worker that pre-caches every lesson, audio and font). |
| `warqa export --zip` | `dist.zip`, one file to share. |
| `warqa export --scorm` | `dist-scorm.zip`: a **SCORM 1.2** package (one SCO per lesson). Import it into Moodle, Chamilo, Canvas…; each lesson reports *completed* and its first-try score (0–100). |
| `warqa export --anki ar` | `flashcards.ar.txt`: tab-separated cards from the questions (with answers and explanations) and the glossary. Anki: *File → Import*, allow HTML. |
| `warqa export --csv fr` | `flashcards.fr.csv` for other flashcard tools. |
| `warqa export --video ar` | `<lesson>.ar.mp4` per lesson (1600×900, H.264 + AAC). Frames are rendered deterministically from the player; question cards stay on screen for a few seconds, then show the answer. Needs ffmpeg. Good for sharing on messaging apps or video platforms. |

## Embedding

The player is one script and one stylesheet (`_warqa/player.js`, `_warqa/player.css`). On any page:

```html
<link rel="stylesheet" href="_warqa/player.css">
<div id="lesson" style="height:600px"></div>
<script src="_warqa/player.js"></script>
<script>
  Warqa.mount(document.getElementById('lesson'), data /* PlayerData */, { storage: true });
  addEventListener('warqa:finish', (e) => console.log(e.detail.right, '/', e.detail.total));
</script>
```

The player emits DOM events `warqa:beat`, `warqa:answer`, `warqa:finish` and `warqa:lang` (the SCORM bridge listens to `warqa:finish`).

## Hosting

Any static host works (GitHub Pages, Netlify, Cloudflare Pages, a school server). Serve with HTTP Range support for audio seeking (`warqa preview` does); the offline cache also answers Range requests.
