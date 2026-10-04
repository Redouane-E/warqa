# Warqa in the browser (the web app)

The web app is the Warqa studio running entirely in a web page: nothing to install, no Warqa server. A teacher
or a parent opens the page, chooses the interface language (العربية, Français, English), pastes a key for an AI
provider, drops a PDF, approves the plan, makes the chapters, previews and edits them, translates them, and
downloads the finished book as a zip that works offline.

It is the same studio as `warqa studio` on a computer (same screens, same pipeline); the differences are listed
under [What needs the desktop version](#what-needs-the-desktop-version).

## For users

1. **Language.** Pick العربية, Français or English. Arabic switches the whole interface to right-to-left.
2. **An AI model.** Choose a provider, create a key on its site (the guide links to the right page) and paste it.
   Warqa checks the key for free (it lists the provider's models; nothing is generated, nothing is billed).
   - **Google Gemini**: free to start (a Google AI Studio key, with daily limits). Good Arabic; reads scanned pages.
   - **OpenRouter**: one key for hundreds of models; pay as you go after adding a few dollars of credit.
   - **DeepSeek**: very cheap (a few cents per chapter); add a small credit first.
   - Also: Anthropic (Claude), OpenAI, Mistral, Groq, xAI, and Ollama on your own computer.
3. **The PDF.** Drop it on the page. Scanned pages are rendered in the browser and read by the vision model.
4. **Languages of the book** and the language the lessons are written in first.
5. **A spending limit**, $1 by default: Warqa stops before your key spends more.

Then the normal studio flow: read the PDF, plan, make lessons, translate (and narrate with an online voice),
review the translations (approve or correct them, or round-trip them through a spreadsheet), export, download.
**See a finished book first** opens the example book, no key needed. Books can also be offered in Moroccan
Darija (الدارجة المغربية).

**Map regions** (Settings → Maps) work in the browser too: geoBoundaries' API allows web pages, and its
downloads are fetched from `media.githubusercontent.com` (the `github.com/…/raw/…` links it returns redirect
without CORS headers, so the web app rewrites them).

### Your data

- Books (PDFs, lessons, audio) and keys are stored **in this browser, on this device** (IndexedDB). There is no
  Warqa server.
- When you make lessons, the text of your PDF (and images of scanned pages) is sent with your key to the
  provider you chose, and to no one else. Keys are sent only to their own provider.
- **Your data → Delete all my books and keys** wipes everything; **Keys → Forget all my keys** removes the keys.
- Clearing the browser's site data deletes your books: use **Download backup** on a book (a zip of the whole
  project). **Import a backup** on the home screen brings it back, here or in another browser; the same zip is a
  normal project folder for the desktop version.
- Your books can be open in one tab at a time; a second tab offers to take them over (the first one saves first).

## What needs the desktop version

| Feature | In the browser |
| --- | --- |
| Edge voices (`edge`, Python) and the local Python worker (`worker`) | Not available (shown as "desktop version only"). Use an online voice or no voice. |
| Visual checks, "Improve with the judge" (both render beats with Playwright) | Not available. |
| Teacher review kits (export) | Not available; the lesson preview's "Rating mode" works. |
| Component packs (`pipeline.components`, code) | Refused, so that a shared book cannot run code next to your keys. Books that use them open in the desktop version. |
| Display math (`math` nodes) typeset to SVG with MathJax | Not available; the player shows the TeX source as text. Inline `$…$` math in text and equations works. |
| Video export, SCORM, flashcards | Not in the studio (CLI). |

### Providers and voices that work from a web page

A page can only call an API that allows other sites to call it (CORS). Checked with
`WARQA_CORS_CHECK=1 pnpm --filter @warqa/web e2e providers`, which uses a dummy key (never a real one): every
provider below answered with a readable "invalid key" error, both for the key check and for a real model call
through the AI SDK (a translation job), so a valid key works.

| Provider | Works in the browser | Notes |
| --- | --- | --- |
| Google Gemini | yes | Wrong keys come back as HTTP 400 "API key not valid". |
| OpenRouter | yes | |
| DeepSeek | yes | |
| Anthropic | yes | Needs the `anthropic-dangerous-direct-browser-access: true` header; the pipeline adds it in browsers. |
| OpenAI | yes | |
| Mistral | yes | |
| Groq | yes | |
| xAI | yes | |
| Ollama, LM Studio, llama.cpp, vLLM (local) | if the server allows the site | Start Ollama with `OLLAMA_ORIGINS=https://<user>.github.io` (or the site's address). Browsers may also ask for permission to reach the local network. |

| Voice | Works in the browser |
| --- | --- |
| OpenAI, ElevenLabs, Google Cloud TTS, Gemini, Azure Speech | yes (checked the same way) |
| Edge (`edge`), the Python worker (`worker`) | desktop version only |
| None | yes: lessons play with captions and synthetic timing |

## How it works

```
page (React)                          Web Worker                               IndexedDB
studio screens (apps/studio/client)   studio API: Hono createApp()             /books  (projects)
fetch('/api/…'), EventSource  ──────▶ pipeline (@warqa/pipeline)       ◀────▶  /home   (keys)
        ▲                             virtual file system (node:fs API)
        │ relays                      pdf.js on OffscreenCanvas
service worker (sw.js): <audio>, <img>, exported books in a new tab, download links → the page → the worker
```

- **The server in a worker.** `apps/web/src/worker/server.worker.ts` runs the studio's own Hono app
  (`createApp` from `apps/studio/src/server/app.ts`) and job runners, so long jobs never freeze the page. The page
  sends it each HTTP request as a message and gets the response back as a stream (Server-Sent Events of running
  jobs included).
- **Node built-ins** are replaced at build time by browser versions (`apps/web/src/shims`): `node:fs` is a
  synchronous in-memory file system persisted to IndexedDB (`worker/vfs.ts`); `node:path` is `pathe`;
  `node:crypto` hashes with `@noble/hashes`; `node:child_process`, `node:vm`, `node:http`, Playwright and
  MathJax's Node build explain that the feature needs the desktop version.
- **Saving.** Every change marks its path; before the worker answers a request that changed something (and when
  a job ends) it writes the marked paths to IndexedDB in one transaction. A reload never loses an answered change.
- **PDFs** are read with pdf.js inside the worker (its own worker code on the same thread), pages are rendered on
  `OffscreenCanvas` for the vision model, and pdf.js data files (CMaps, fonts, wasm) are static files of the site.
  The pipeline's injection point is `setPdfPlatform()` in `packages/pipeline/src/ingest/pdf.ts`.
- **Exports** copy the lesson player from the site's own `player/` folder and are zipped with fflate.
- **The service worker** (`apps/web/public/sw.js`) caches nothing: it hands the browser's own loads of
  `…/api/…` and `…/books/…` (narration audio in the preview, an exported book opened in a new tab, download
  links) to an open Warqa tab. Without it (some private windows) the app still works: the preview gets in-memory
  copies of its audio, and download links are saved by the page; only opening an exported book in a new tab is
  unavailable.

## Running it

```sh
pnpm install
npx turbo run build --filter=@warqa/web^...   # the packages the web app is built from (lesson, pipeline, i18n)
pnpm --filter @warqa/web dev                    # http://localhost:5180/
pnpm --filter @warqa/web build                  # → apps/web/dist (base "/")
pnpm --filter @warqa/web preview                # serves apps/web/dist on http://localhost:4180/
```

Tests:

```sh
pnpm --filter @warqa/web test                   # unit tests (virtual file system, test model), in Node
pnpm --filter @warqa/web e2e:install            # once: Playwright's Chromium
pnpm --filter @warqa/web e2e                    # builds under /warqa/, serves it, runs the browser tests
WARQA_CORS_CHECK=1 pnpm --filter @warqa/web e2e providers   # also checks providers and voices over the network
```

**Test mode.** `?warqa-fake=1` in the address (for this tab) adds a hidden "Test model" provider: a scripted
model that answers every pipeline call without any network, through the pipeline's `FakeModel` hook. The browser
tests use it to make a whole book. `?warqa-fake=0` turns it off; `VITE_WARQA_FAKE=1` at build time turns it on
for a build.

## Publishing on GitHub Pages

The site is static. Build it with the path it will be served under:

```sh
WARQA_BASE=/<repository>/ pnpm --filter @warqa/web build    # e.g. WARQA_BASE=/warqa/
```

and publish `apps/web/dist`. GitHub Pages answers unknown paths with `404.html`, which the build makes a copy
of the app, so links such as `/warqa/project/my-book` work after a reload. In GitHub Actions,
`GITHUB_REPOSITORY` is set, and the "Desktop version" link points to that repository (`WARQA_REPO_URL`
overrides it). A workflow step:

```yaml
- run: pnpm --filter @warqa/web... build     # builds the packages it needs, then the app
  env:
    WARQA_BASE: /${{ github.event.repository.name }}/
- uses: actions/upload-pages-artifact@v4
  with:
    path: apps/web/dist
```

The site needs HTTPS (GitHub Pages provides it): service workers and some browser APIs only work on secure
origins (and on `localhost`).
