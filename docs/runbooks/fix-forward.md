# Fix Forward Runbook

How to ship a corrective change during a live incident.

| | |
| --- | --- |
| **Principle** | Restore service first. Root cause can wait |
| **First action** | Decide whether this needs a deploy at all (see the table below) |

There's no automated rollback. Every merge to `main` is released and deployed, so a rollback is a revert commit that ships as a new patch version (see [Releases](../releases.md)).

---

## Choose a strategy

| Situation                                                        | Strategy                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The fault is understood and the fix is small                     | Fix forward                                                               |
| The fault appeared right after a deploy                          | Revert, shipped as a fix forward                                          |
| Bad configuration (an SSM value or secret)                       | No deploy. Correct the value; it takes effect within 10 minutes           |
| An upstream outage (GOV.UK, UNS)                                 | No deploy. Follow the dependency runbook and escalate                     |
| The cause is unknown and impact is severe                        | Mitigate first (below), then investigate                                  |
| Bad data (a `sourceStore` row, a DLQ message)                    | A data fix, not a deploy                                                  |

### Mitigations that don't need a deploy

- **Stop new events:** disable the `<env>-ebschedule-*TravelSchedule` rules.
- **Pause instant notifications:** disable the `single-event` stream trigger. Records wait in the stream for up to 24 hours.
- **Silence one country:** set `sourceEnabled = false` on its `sourceStore` row.

Note every manual change in the incident channel. The next deploy re-enables EventBridge rules.

---

## Ship the fix

Before you ship:

- Find the suspected release from the `release-notifications` channel or by running `git tag --sort=-creatordate | head`.
- Change only what's needed.
- Prefer a Lambda code change over a CDK change.
- Title the PR `fix(<TICKET>): …`.
- Get a second pair of eyes on it.

1. **Standard path:** open the PR, check the fix on its `pr-<n>` stack, then merge. `main.yml` deploys development, then staging.
2. **Redeploy without a new release** (development or staging only): run **Build & Deploy** ([`_build_deploy.yml`](/.github/workflows/_build_deploy.yml)) from the Actions tab.

---

## Validate

1. The stack shows the new version (see [Verify Environment Health](./verify-environment-health.md#1-the-stack-is-deployed-at-the-expected-version)).
2. The original symptom is gone, and the stages downstream are healthy too.
3. The alarms have cleared, and every mitigation has been undone.

Afterwards, raise follow-up work for the root cause and update this runbook with anything new you learned.

---

## Related

- [Deployment Guide](../deployment.md)
- [Releases and Versioning](../releases.md)
