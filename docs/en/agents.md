# Using Warqa from coding agents (MCP)

Warqa ships an MCP server, so agents such as Claude Code, Cursor or any MCP client can make lessons with it — either by running the pipeline with your configured models, or by **authoring lessons themselves** with Warqa as the validator and renderer (the way Papermorph worked, but with any agent and a declarative format).

```bash
pnpm build
claude mcp add warqa -- node /path/to/warqa/apps/mcp/dist/server.js
```

## Tools

| tool | does |
| --- | --- |
| `warqa_guide` | how to author lessons with these tools (read first) |
| `warqa_component_catalog`, `warqa_lesson_schema` | what a lesson can contain |
| `warqa_create_project`, `warqa_ingest`, `warqa_read_source` | start a book, read the PDF, get the text of pages |
| `warqa_validate_lesson` | schema + semantic checks against the scene; returns errors to fix |
| `warqa_save_lesson`, `warqa_strings`, `warqa_save_strings` | save a lesson; list strings to translate; save a translation (marks and boxes checked) |
| `warqa_render` | headless render: QA issues + contact sheets as images for the agent to look at |
| `warqa_build_chapter`, `warqa_narrate`, `warqa_export`, `warqa_preview`, `warqa_status` | run the pipeline, synthesize audio, export, serve |
| `warqa_improve` | judge in the loop: a vision model scores each rendered beat; weak beats are rewritten with its notes |
| `warqa_review` | translation review: states, glossary and mark problems; approve or edit a string (kept by later translations) |
| `warqa_geo_add` | add the regions of a country for maps (geoBoundaries), with their names, codes and licence |

A typical authoring loop: `warqa_read_source` → write the lesson JSON → `warqa_validate_lesson` until clean → `warqa_save_lesson` → `warqa_render` and fix what looks wrong → `warqa_save_strings` for each language → `warqa_narrate` → `warqa_export`.
