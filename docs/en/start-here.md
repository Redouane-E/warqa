# Start here

**For teachers, students, and anyone learning on their own.** No programming needed. [العربية](../ar/start-here.md) · [Français](../fr/start-here.md)

## What Warqa does

You give Warqa a PDF: a textbook chapter, a worksheet, a story. Warqa uses an AI service to turn it into
short **animated lessons**: a voice explains while the picture changes on the very words that explain it,
with quick questions inside the picture. Lessons can be in Arabic, French, English and other languages,
and a learner can switch language in the middle of a lesson.

The result is a small website you can share as one `.zip` file. It works **without internet** and without
an account, on a computer, a tablet or a phone.

Want to see one first? Open the example lesson: <https://redouane-e.github.io/warqa/demo/>

No PDF at hand? Try one of the [sample PDFs](../../examples/pdfs/README.md): an Arabic maths chapter, a French science chapter and an Arabic picture book.

## Three ways to use Warqa

| | What you need | Good for |
| --- | --- | --- |
| **1. In your browser** | nothing to install | trying Warqa today |
| **2. One-click launcher** | Docker Desktop or Node.js (the launcher tells you) | regular use on your computer, every feature |
| **3. Docker** | Docker, and a terminal | people at ease with commands, school servers |

**1. In your browser.** Open <https://redouane-e.github.io/warqa/>. Everything runs in the page: your books and
your key stay in this browser, on this computer. This version is the newest; if something you need is
missing, use way 2.

**2. One-click launcher.** On the Warqa page on GitHub, click the green **Code** button →
**Download ZIP** (or take the latest *Release*), and unzip it. Open the `launchers` folder and double-click:

- Windows: `Warqa-windows.bat`
- Mac: `Warqa-mac.command` (the first time: right-click → *Open* → *Open*)
- Linux: `warqa-linux.sh`

If your computer is missing something, the launcher says what to install, with links. The first start
takes 5 to 20 minutes; after that, a few seconds. Warqa then opens in your browser at
<http://127.0.0.1:5170/>. Your books are saved in the `books` folder. More help: [launchers/README.md](../../launchers/README.md).

**3. Docker.** In the Warqa folder, run `docker compose up -d`, then open <http://localhost:5170/>.

## Get an AI key

Warqa uses an AI service to read your PDF and write the lessons. A **key** is a long password that lets
Warqa use the service on your account. Keep it secret: anyone who has it can spend your credit.

Choose one to start:

- **Google Gemini: free to start.** Go to <https://aistudio.google.com/apikey>, sign in with a Google
  account and click *Create API key*. The free tier has daily limits. On the free tier, Google may use what
  you send to improve its products, so only use documents you are allowed to share. In Warqa, choose the
  model set **Gemini only**.
- **DeepSeek: very cheap.** Go to <https://platform.deepseek.com>, add a small amount of credit (a few
  dollars goes a long way), then create a key under *API keys*. Add a Gemini key as well and choose the set
  **Budget**: DeepSeek writes, Gemini reads the pages.
- **OpenRouter: one key for hundreds of models.** Go to <https://openrouter.ai/keys>, buy some credit and
  create a key. The set **OpenRouter (one key)** uses a high-quality writer, which costs more than the two
  options above.

Then, in Warqa, open **Keys**, paste the key and click **Save keys**.

> **About cost.** Apart from free tiers, AI services charge for each use. With the cheap options, a chapter
> usually costs a few cents; the best models cost more. Before you start, Warqa shows an estimate
> (*To build everything*), and it shows what you have spent (*Spent so far*). To be safe:
> - set a **spending limit** in your book's **Settings → Budget and tools → Spending limit (USD)**, for
>   example 1 or 2. Warqa stops before going over it;
> - prefer **prepaid credit** on the service's website, and set a limit there too;
> - doing a step again is free: Warqa remembers the answers it already paid for.

Nothing to pay at all, and nothing leaving your computer: Warqa can also use models that run on your own
computer with Ollama (you need a recent, powerful computer). See [models.md](models.md).

## Learning on your own

Warqa can also teach you. Drop a PDF you want to understand, pick your language and your level, and chapter 1
is ready in a few minutes. There is no plan to approve.

1. The first time you open Warqa, it asks **How will you use Warqa?** Choose **I'm learning for myself**.
   (Teachers choose **I teach** and follow [Your first book, step by step](#your-first-book-step-by-step).)
   Later, start a new course with **Learn something new** on **What I'm learning**.
2. **Drop the PDF** you want to understand. Lessons made from it are for your own use unless you have the
   right to share them.
3. **Pick the language Warqa teaches you in:** **العربية**, **الدارجة**, **Français** or **English**. Warqa
   tells you which language the PDF is in, and keeps its key terms.
4. **Pick your level:** **Beginner**, **I know some** or **Advanced**.
5. If no AI service is connected yet, Warqa asks you to connect one (see [Get an AI key](#get-an-ai-key)).
6. Before anything is spent, Warqa shows the time and the cost, for example "About 3 minutes · about $0.03 ·
   your limit $1.00". Click **Teach me**: Warqa reads the PDF, plans the chapters and makes chapter 1 in one
   go, then opens it. **Stop** keeps what is finished. In the browser version, keep the tab open while
   Warqa works.
7. At the end of a chapter:
   - **How was this chapter?** **Too easy**, **About right** or **Too hard** changes the level of the next
     chapters;
   - **Review what you missed** takes you back to the questions you missed;
   - **Make chapter 2 · about $0.04** makes the next chapter, only when you ask. You never pay for chapters
     you don't read.

Your courses are listed on **What I'm learning**. A course is an ordinary book: **Open as a teacher** shows
every step if you want to change something. If you would rather check the plan yourself, click **I'd rather
review the plan first** instead of **Teach me**, and you follow the teacher's path.

A new course has a spending limit of $1. Change it in the book's **Settings → Budget and tools → Spending
limit (USD)**. On the command line: `warqa learn my.pdf --lang ar --level beginner` (levels: `beginner`,
`some`, `advanced`).

## Your first book, step by step

Start small: one chapter of 10 to 20 pages.

1. **Open Warqa** and choose the **Interface language** at the top of the page.
2. Open **Keys**, paste your key, click **Save keys**.
3. In **Your books**, click **New book**. Drop the PDF where it says **Drop the PDF here**, give a title,
   tick the **Languages of the lessons**, choose the language **Lessons are written first in**, and say
   **Who are the lessons for?** (for example "first year of middle school"). Click **Create book**.
4. Open the book's **Settings**. Under **AI models**, choose a **Model set** that matches your key (or leave it on automatic). Under
   **Budget and tools**, set a **Spending limit (USD)**. Click **Save settings**.
5. **Read the PDF.** To start small, fill in **Only these pages** (for example `1-20`), then click
   **Read the PDF**.
6. **Plan.** Click **Draft the plan**. Read the chapters, untick the ones you do not want, then click
   **Approve the plan**.
7. **Make lessons.** Each chapter shows what it should cost beside **Make**. Click **Make** next to one
   chapter. The work shows at the bottom of the window: its stages and the beats as they are written, with
   what it has spent. **Stop** keeps the beats already written; **Make the rest** goes on from there.
8. **Look and fix.** Click **Edit** to watch the lesson in the **Preview**. Change a sentence, or use
   **Regenerate this beat** with a short instruction such as "shorter, with a balance scale".
9. **Translate & narrate** into the other languages: each language is a card; under the cards, check the
   translations sentence by sentence.
10. **Check** (optional, desktop version): **Run the checks** shows the end of every beat, the judge's score in red
    pen and what an automatic check found. **Improve weak beats** rewrites those scored under 4.
11. **Share.** Click **Export the book**, then **Open the book** to try it or **Download .zip** to share it. The zip
    works offline. Other ways: a SCORM package for Moodle (it reports scores, see [exports.md](exports.md)),
    flashcards for Anki, videos (desktop version) and a backup of the whole book.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Mac: "Apple could not verify…" | Right-click the launcher → *Open* → *Open*, or *System Settings → Privacy & Security → Open Anyway*. |
| Windows: "Windows protected your PC" | Click *More info* → *Run anyway*. |
| The browser does not open | Wait for the first start to finish, then open <http://127.0.0.1:5170/> yourself. |
| "Port 5170 is in use" | Warqa is already running: open <http://127.0.0.1:5170/>. |
| "No model yet: add a key" or "needs …_API_KEY" | Add a key in **Keys**, and choose a **Model set** that uses that key. |
| "budget reached" | You hit your spending limit. Raise it in **Settings** only if you agree. |
| An error with 401 or 403 | The key is wrong or was deleted. Create a new one and paste it again. |
| An error with 429, "quota" or "rate limit" | Too many requests (free tiers have limits). Wait a little and click again: finished work is kept. |
| Arabic text looks broken, or the pages are photos | Click **Read again** with **Scanned or broken pages** ticked, and use a model set that reads images (Gemini). |
| No sound | The free voices need internet. With the launcher's Node.js mode, install [uv](https://docs.astral.sh/uv/getting-started/installation/), or use Docker. |
| A lesson is not good | **Regenerate this beat** with an instruction, or try a better model set for that chapter. |

Still stuck? Tell us with the form **"My PDF didn't work"**: <https://github.com/Redouane-E/warqa/issues/new/choose>.
No code needed, and you can write in Arabic, French or English. **Never paste your key.**

## Your rights and your students

Use PDFs you are allowed to use. Your PDF stays on your computer (or in your browser); parts of it are
sent to the AI service you chose, to read and write the lessons. Never put personal information about
students into Warqa. The books you make are yours.

Lessons made from a PDF are for your own use unless you have the right to share them.
