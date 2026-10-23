# CI reference

`.github/workflows/docker-publish.yml` runs verification on pull requests to
`main`, pushes to `main`, merge-queue requests, and manual runs. A daily run at
15:23 UTC adds Firefox and WebKit. Scheduled runs never publish images.

## Required checks

| Job                                     | Checks                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                                | Prettier across the repository.                                                                                                                                |
| `types`                                 | Svelte and TypeScript diagnostics, including warnings, plus type checks for browser tests and CI scripts.                                                      |
| `tests`                                 | Existing Bun unit and WebSocket integration tests, with text and LCOV coverage reports.                                                                        |
| `Production build`                      | A production build and a report of the largest JavaScript assets by gzip size.                                                                                 |
| `Browser and accessibility`             | Chromium desktop and mobile emulation on every run. Firefox and WebKit also run daily and when a manual run has `full` enabled.                                |
| `Dependency vulnerabilities`            | Bun's advisory audit, including development dependencies. High and critical findings fail. A registry error also fails.                                        |
| `Workflows and secrets`                 | Actionlint checks workflow expressions and embedded shell scripts. Gitleaks scans Git history and redacts findings.                                            |
| `Container startup and vulnerabilities` | A disposable amd64 Docker build, healthcheck, HTTP routes, Socket.IO handshake, restart, and Trivy scan. Fixable high and critical image vulnerabilities fail. |
| `CI required`                           | Requires every verification job to finish successfully. A skipped, failed, or cancelled dependency cannot make this check green.                               |

`CI required` is the status check intended for the branch ruleset. The workflow
does not configure branch protection or require checks through the GitHub API.
Without a ruleset, GitHub can still allow a merge despite a failing check.

Image publishing depends on `CI required`. Successful pushes to `main` and manual
runs retain the existing GHCR destinations, tags, and amd64/arm64 publishing
matrix. Manual runs still publish images, as they did before this CI change.
Both image architectures must build before the workflow publishes the shared
manifest. The disposable runtime check runs on amd64, not arm64.

## Browser coverage

`tests/e2e/` exercises the built application through `server.ts`. The tests use a
fixed loopback address and a fresh SQLite database per server run. They refuse to
reuse a server already listening on the test port. Production data is never a
test fixture.

The browser journeys cover:

- Basic Facts keyboard answers, accessibility preferences, and focus mode.
- Factor Finder answer validation and status announcements.
- Digitle guess persistence after a reload.
- Make 24 expression validation, results, and completed-puzzle restoration.
- Crossmath keyboard tile placement and saved progress.
- Mathex JSON upload, room creation, host/player sessions, answers, reconnection,
  confirmation dialogs, results, and JSON export.
- Mobile navigation, dialog focus containment/restoration, horizontal overflow,
  and a 320 CSS-pixel layout with enlarged text.

Unexpected JavaScript exceptions fail browser tests. CI permits one retry for
diagnosis, but a test that only passes on retry still fails the run.

## Accessibility coverage

The target is WCAG 2.2 AA. Axe checks WCAG A/AA rules and best-practice rules on
15 representative routes in light and dark themes. Additional scans cover help
dialogs, the disclaimer, form errors, expanded room options, game questions,
confirmation dialogs, and results. Text contrast stays enabled. Each scan also
asserts that axe actually evaluated its contrast rule.

There are no accepted-violation lists, excluded page regions, or disabled axe
rules. Existing violations in these scans fail alongside new violations.
Accessibility reports retain axe's `incomplete` results for human review. An
incomplete result is not a confirmed violation and does not fail automatically.

Automation does not establish WCAG compliance. Mathematical notation, canvas
content, meaningful screen-reader announcements, non-text contrast, real-device
zoom, and task usability still need [manual accessibility review](accessibility-review.md).
The editor, collaborative editing UI, calculator internals, PDF output, and the
physical competition marker/scoreboard workflows do not yet have dedicated
browser journeys. Their existing unit/integration coverage is unchanged.

## Reports and runtime

GitHub Actions artifacts retain browser HTML/JUnit reports, axe JSON reports,
failure traces, server logs, coverage, redacted secret findings, and dependency
and container audit reports for seven days. Build artifacts expire after one
day. Browser screenshots and video capture are disabled, including screenshots
inside traces.

PR checks run in parallel, with a target of about ten minutes. That target has
not been measured on GitHub Actions yet. Browser execution has an eight-minute
global limit per project. Job timeouts also bound installation and image work.

Bundle sizes are reports, not performance gates. There is no calibrated loading
or interaction performance budget, no Lighthouse score requirement, and no
visual snapshot suite.

## Versions and permissions

Bun is pinned to `1.4.3` in CI and both Docker stages. Playwright and axe use exact
package versions in `package.json` and `bun.lock`. Actions use commit SHAs.
Actionlint and Gitleaks downloads use fixed versions and SHA-256 checksums.
Dependabot proposes weekly updates to GitHub Actions pins.

Verification jobs have read-only repository access and do not receive deployment
secrets. Only publishing jobs have package-write permission. Checkout does not
persist Git credentials. Superseded runs cancel within the same event/ref group.
