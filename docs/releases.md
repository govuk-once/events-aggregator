# Releases and Versioning

How release versions are calculated and how they reach a deploy. Releases are fully automated with [semantic-release](https://github.com/semantic-release/semantic-release), so you never tag anything by hand.

---

## How the version is determined

On every push to `main`, the `Release` job in [`main.yml`](/.github/workflows/main.yml) runs `pnpm run semantic:release`. It reads [`.releaserc`](/.releaserc) and analyses each commit since the last tag using the Angular commit-analyzer preset with these rules:

| Commit type                                           | Bump              | Example                                      |
| ----------------------------------------------------- | ----------------- | -------------------------------------------- |
| `BREAKING` / `BREAKING CHANGE`                        | Major (`2.0.0`)   | `BREAKING CHANGE(NOT-789): drop v1 payload`  |
| `feat`                                                | Minor (`1.2.0`)   | `feat(NOT-559): add weekly digest`           |
| Anything else (`fix`, `chore`, `docs`, `ci`, …)       | Patch (`1.1.1`)   | `fix(NOT-530): change source of lastUpdated` |

> The `{ type: '*' }` and `{ message: '*' }` fallback rules mean **every** merge to `main` cuts at least a patch release, including `docs` and `chore` commits.

When a release is cut, semantic-release:

1. Creates and pushes the git tag `v<version>`.
2. Generates release notes and creates a **GitHub Release** (`@semantic-release/release-notes-generator` + `@semantic-release/github`). Success and failure comments on PRs are turned off.
3. Writes `semVer=<version>` to `$GITHUB_OUTPUT`. The deploy jobs pass it on as `VERSION=<semver>@<sha>`.

`@semantic-release/npm` runs with `npmPublish: false`, so nothing is published. The bumped `package.json` version isn't committed back, which is why the file reads `0.0.0`.

A tag means the code is merged and versioned. It does **not** mean the code has reached every environment. See [Deployment Guide](./deployment.md).

---

## Commit message format

PRs are squash-merged, so **the PR title becomes the release commit**. The title is validated by [`_validate_pr.yml`](/.github/workflows/_validate_pr.yml):

```text
<type>(<TICKET-REF>): <description>
```

- **Type:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` or `test`.
- **Scope:** required. 2–6 upper-case letters, a hyphen, then 1–5 digits (`NOT-559`). Use `NOT-000` when there's no ticket.
- An optional `!` before the colon marks a breaking change.

Only the PR title is validated. Dependabot PRs (`fix(deps): …`) skip the check.

---

## Deployment notifications

After each successful pipeline deploy (but not for PR stacks), [`_build_deploy.yml`](/.github/workflows/_build_deploy.yml) publishes a custom Amazon Q notification to the stack's `release-notifications` SNS topic, which appears in Slack with the version, the environment and a link to the release notes.

The step needs `sns:Publish` on the topic and `kms:GenerateDataKey*` / `kms:Decrypt` on `NotificationEncryptionKey`. If it fails, the deploy still succeeds and the job summary shows the reason. The Slack channel wiring is described in [Infrastructure Development Guide: Slack notifications](./infrastructure-development.md#slack-notifications).

---

## Troubleshooting

- **No new tag after a merge.** Check the `Release` job log. semantic-release skips a release if it can't parse any commit. Make sure the squash-merge title kept its conventional format.
- **`semVer` is empty in the deploy.** The release was skipped, so `VERSION` becomes `@<sha>` and the Slack link falls back to the workflow run.

---

## Related

**Guides:**

- [Deployment Guide](./deployment.md)
- [Fix Forward Runbook](./runbooks/fix-forward.md)

**Code:**

- [`.releaserc`](/.releaserc)
- [`main.yml`](/.github/workflows/main.yml)
