# Releasing Warqa

For maintainers. A release is a `vX.Y.Z` tag on `master`. Pushing the tag runs
[`.github/workflows/release.yml`](../../.github/workflows/release.yml), which:

1. checks that the tag matches the root `package.json` version and that `CHANGELOG.md` has a section for it;
2. builds the Docker image for `linux/amd64` and `linux/arm64` and pushes it to
   `ghcr.io/<owner>/<repo>` with the tags `X.Y.Z`, `X.Y`, `X` (not for 0.x) and `latest` (stable releases only);
3. creates the GitHub Release, with the CHANGELOG section as its text and a `docker pull` line.

The GitHub Pages site (web app + example book under `/demo/`) is deployed separately, on every push to
`master`, by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml).

## Versions

[Semantic Versioning](https://semver.org). Before 1.0: a **minor** release (0.2.0) may change the lesson
format or the CLI, with a **Breaking** note and a migration path in the CHANGELOG; a **patch** release
(0.1.1) only fixes things. Pre-releases look like `v0.2.0-rc.1`: they are marked as such on GitHub and do
not move `latest`.

All packages share one version. It appears in:

- `package.json` at the root and in `packages/*`, `apps/*`, `e2e`, `evals`;
- `apps/cli/src/warqa.ts` (`.version(…)`) and `apps/mcp/src/server.ts` (`new McpServer({ … version })`);
- `workers/py/pyproject.toml`, `workers/py/warqa_worker/__init__.py` and the worker's health test.

```bash
# every place that holds the current version (here 0.1.0)
grep -rn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.venv --exclude='*.lock' \
  -e '0\.1\.0' package.json packages apps e2e evals workers/py
```

## Cutting a release

1. **Make sure `master` is green**: the CI run of the last commit passed, including the end-to-end tests in
   all three browsers.
2. **Try the image build** if the Dockerfile, dependencies or the Playwright version changed:
   *Actions → Release → Run workflow* on `master` builds both architectures without pushing anything.
3. **Prepare a pull request** "Release vX.Y.Z":
   - bump the version everywhere listed above;
   - in `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today's date), add an empty
     `## [Unreleased]` above it, and update the links at the bottom;
   - check the section reads well as release notes: `.github/scripts/release-notes.sh vX.Y.Z`;
   - `pnpm install` (to refresh the lockfile if needed), `pnpm build && pnpm lint && pnpm test`.
4. **Merge it**, then tag the merge commit and push the tag:

   ```bash
   git switch master && git pull
   git tag -a vX.Y.Z -m "Warqa vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. **Watch the Release workflow.** The arm64 image is built under emulation and can take 30–60 minutes.
6. **Check the result**: the release page, `docker pull ghcr.io/<owner>/<repo>:X.Y.Z`, then
   `docker run --rm -p 127.0.0.1:5170:5170 ghcr.io/<owner>/<repo>:X.Y.Z` and open <http://127.0.0.1:5170/>.
7. **Announce it** in Discussions (in English, Arabic and French if you can).

If something fails after the tag was pushed: fix it on `master`, delete the release and the tag
(`git push --delete origin vX.Y.Z`), and tag again. Never move a tag that people may already have pulled;
prefer a new patch release.

## First publication (one time)

Before the repository goes public:

- [x] **Links and URLs** point to `Redouane-E/warqa` (Pages: `https://redouane-e.github.io/warqa/`, images:
  `ghcr.io/redouane-e/warqa`). If the repository moves, search for `Redouane-E` and `redouane-e` and update them.
- [x] **Code of Conduct contact**: private reports go through GitHub's private vulnerability reporting.
- [x] **Maintainers**: listed in `GOVERNANCE.md`.
- [ ] **Labels**: create the labels listed in `GOVERNANCE.md` (issue forms only apply labels that exist).
- [ ] **Discussions**: *Settings → General → Features → Discussions*, with a *Q&A* category (the issue chooser links to it).
- [ ] **Private vulnerability reporting**: *Settings → Code security → Private vulnerability reporting* (used by `SECURITY.md` and the issue chooser).
- [ ] **Pages**: *Settings → Pages → Build and deployment → Source: GitHub Actions*. If the site is a project
  site (`https://<owner>.github.io/warqa/`), the web app must be built with a relative base or with
  `WARQA_BASE_PATH`, which the workflow sets to `/<repo>/`.
- [ ] **Actions permissions**: *Settings → Actions → General → Workflow permissions: Read repository contents* (the workflows ask for more only where needed).
- [ ] **Branch protection** on `master` (a ruleset): require a pull request and the checks
  *Build, lint, typecheck, test*, *E2E (chromium)* and *Python worker*.
- [ ] **Container package**: after the first release, open the package on the organisation's *Packages*
  page and set its visibility to **public** (new GHCR packages are private), so `docker pull` works without logging in.
- [ ] **Dependabot**: *Settings → Code security*: enable Dependabot alerts and security updates
  (version updates are configured in `.github/dependabot.yml`).
- [ ] **Funding** (optional): uncomment `.github/FUNDING.yml`.

### Hardening (recommended)

- Pin third-party actions to commit SHAs (`zizmor --offline .github/workflows` lists them; tools such as
  `pinact` or `ratchet` rewrite them). Dependabot keeps SHA pins up to date and keeps the version comment.
- Keep `permissions` per job as they are: read-only by default, `packages: write` only for the image,
  `contents: write` only for the release, `pages`/`id-token` only for the deployment.
- Native arm64 runners (`ubuntu-24.04-arm`, free for public repositories) can replace QEMU if the image
  build becomes too slow: build each platform on its own runner, push by digest, then merge the manifests
  (see Docker's "multi-platform builds" guide).
