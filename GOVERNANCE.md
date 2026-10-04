# Governance

Warqa is a small project with a simple, written-down way of working. This file can change through a pull
request reviewed by the maintainers.

## Roles

- **Users** make books with Warqa, report problems and share ideas. Teachers' feedback on lessons is a
  first-class contribution.
- **Contributors** send pull requests: code, components, UI translations, docs, example books, evaluations.
  Anyone can become one; see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Maintainers** review and merge pull requests, triage issues, cut releases and enforce the
  [Code of Conduct](CODE_OF_CONDUCT.md). They are listed below.

### Maintainers

| Maintainer | Areas |
| --- | --- |
| [@Redouane-E](https://github.com/Redouane-E) | everything (founder) |

## How decisions are made

- **Lazy consensus.** Most changes are decided in the pull request. If a maintainer approves and nobody
  objects with reasons, it is merged.
- **Bigger changes** (the lesson format `warqa.lesson/*`, the player's public events, the CLI's commands,
  licensing, new runtime dependencies, anything that breaks existing books) start as an issue or a
  Discussion and wait at least a week for comments before being merged.
- When people disagree and no consensus appears, the maintainers decide by simple majority. The reasons
  are written down in the issue or pull request.
- **Teaching quality matters as much as code.** For changes that alter how lessons teach (prompts, pacing
  rules, validators), feedback from teachers weighs as much as technical review.

## Becoming a maintainer

A contributor who has made several good contributions over a few months, reviews others' work kindly and
knows part of the code well can be invited by the maintainers (or ask to be considered). A maintainer
who has been inactive for a year may be moved to an "emeritus" list, with thanks.

## Releases

Maintainers release from `main` by pushing a `vX.Y.Z` tag; see [docs/en/release.md](docs/en/release.md).
Versions follow [Semantic Versioning](https://semver.org); before 1.0, minor versions may change the lesson
format, with a migration note in the [CHANGELOG](CHANGELOG.md).

## Issue labels

| Label | Meaning |
| --- | --- |
| `needs-triage` | new, not looked at yet |
| `bug`, `enhancement` | something broken; an improvement |
| `pdf-help` | a user's PDF did not work |
| `component`, `language`, `translation` | new component; new language; UI wording |
| `good first issue`, `help wanted` | good for newcomers; maintainers would welcome help |
| `dependencies`, `ci`, `docker`, `worker` | used by Dependabot and for infrastructure |

(Create these labels once in the repository settings: issue forms only apply labels that exist.)

## Licence and contributions

Warqa is licensed under [Apache-2.0](LICENSE). Contributions are accepted under the same licence
(inbound = outbound); there is no contributor licence agreement. See [CONTRIBUTING.md](CONTRIBUTING.md#licence-of-contributions).

## Code of Conduct

Everyone in the project's spaces follows the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers enforce it
and step aside from cases that involve them.
