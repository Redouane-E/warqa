---
name: review-change
description: Review a Warqa change (uncommitted diff, branch or pull request) against the project's rules - correctness, right-to-left handling, every interface language, browser compatibility of the pipeline, key safety, generated files, tests. Use after implementing a change, before committing, or when asked to review a PR.
---

# Review a change

Review a change to Warqa (an Arabic-first open-source app that turns PDFs into narrated, interactive
lessons) the way a maintainer would. Read `AGENTS.md` first, and the nested `AGENTS.md` of every folder the
change touches. Report findings; do not fix them unless you are asked to.

1. Get the change: `git diff` (uncommitted), `git diff master...HEAD` (branch), or the PR diff you are given.
   Read every changed file in full where needed, not only the hunks.
2. Check, in this order, and report only real problems with file:line and a concrete failure scenario:
   - **Correctness:** logic errors, missing cases, broken edge cases (empty lessons, beats without audio,
     unknown languages, Arabic text).
   - **Right to left:** reading-order UI mirrors; number lines, planes, maps, clocks and math do not. Arabic
     text gets `dir`/`lang`, and mixed-script cells `dir="auto"`.
   - **Every language:** new player strings are in `en`, `fr`, `ar` and `ary`; new studio strings in `en`,
     `fr` and `ar`. The text must be real, not copied English. Lesson-visible props are in the component's
     `text` paths.
   - **Pipeline in the browser:** new Node-only imports have a shim in `apps/web`; new desktop-only jobs are
     in `desktopOnlyJobs`.
   - **Keys and money:** no key read or written outside the key store or `.env`; nothing that spends model
     credits in tests (tests must use `FakeModel`).
   - **Generated files and build order:** `docs/en/components.md` regenerated if components changed;
     nothing in `dist/`; dependent packages still build (`npx turbo run build --filter='...[HEAD]'`).
   - **Tests:** a change in behaviour comes with a test that would have failed before it. Run the affected
     packages' tests and say what you ran.
   - **Lesson format:** backward compatible, or a CHANGELOG entry with a migration note.
3. End with a short verdict: ready, or the list of blocking issues first and then optional suggestions. Do
   not pad the review with style nits; Biome handles formatting.
