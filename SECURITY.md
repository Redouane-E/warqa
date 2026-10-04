# Security

- **API keys** are read from the environment or `.env`, or entered in the studio (stored in `~/.warqa/keys.json` with mode 0600). They are never written into book projects, exports or logs. The studio listens on 127.0.0.1 by default; if you expose it on a network, put it behind authentication.
- **Exports** are static files with the lesson data inlined; they contain no keys and make no network calls (fonts and the player are bundled).
- **Source PDFs** stay in `source/` and are never exported; `cache/` holds model responses and may contain text from your PDF.
- The math expression parser used for plots is a small recursive-descent parser — no `eval`.

Report vulnerabilities privately to the maintainers (see the repository's security advisories page) rather than in public issues.
