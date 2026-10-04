# Warqa — Claude Code

The guide for every coding agent is `AGENTS.md`; this file only adds what is specific to Claude Code.

@AGENTS.md

## Claude Code specifics

- **Skills:** `.claude/skills` links to `.agents/skills`, the shared procedures listed in `AGENTS.md`
  (`/verify`, `/visual-qa`, `/review-change`, `/add-component`, `/ui-strings`, `/author-lesson`).
- **Folder rules:** each folder with a nested `AGENTS.md` also has a `CLAUDE.md` that imports it, so Claude
  Code loads it when working there.
- **Subagents** (`.claude/agents/`):
  - `warqa-reviewer` reviews a change with the `review-change` procedure.
  - `ui-checker` renders and inspects screenshots with the `visual-qa` procedure, keeping images out of the
    main conversation.
- **Hooks** (`.claude/settings.json`):
  - Edits to `.env`, keys, lockfiles, `dist/`, books' generated folders and `docs/en/components.md` are
    refused. Edit the source and regenerate instead.
  - Every edited TS/JS file is formatted and safely fixed with Biome. Remaining errors come back to you.
- **Permissions:** build, test, lint and read-only git commands run without asking. Commits, pushes, `gh`,
  and the `warqa` commands that spend model credits always ask. `.env` and `~/.warqa` are not readable.
- **Commits** made by Claude Code carry no Claude attribution (`attribution` in `.claude/settings.json`).
  The person who commits is the author.
- **MCP servers** (`.mcp.json`; approve them when asked): `warqa` (needs `pnpm build`) and `playwright`.
- Personal preferences go in `CLAUDE.local.md` or `.claude/settings.local.json` (both git-ignored).

## Working style here

- Explore and plan before non-trivial edits: packages are coupled through their built `dist`, and a change in
  `packages/lesson` usually reaches the pipeline, the apps and e2e.
- Look at what you change: player and UI work is done only after seeing screenshots in Arabic and in a
  left-to-right language.
- Never call a check passed without running it. Report commands and counts.
