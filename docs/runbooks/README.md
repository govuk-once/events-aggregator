# Runbooks

Operational runbooks for the Events Aggregator. Use the tables below to find the runbook that fits your situation.

### Alarm-driven

Every alarm this service raises is named `<priority>-<resource>-<condition>` (see [Infrastructure Development Guide: CloudWatch alarms](../infrastructure-development.md#cloudwatch-alarms)). Match the suffix of the alarm that fired:

| Alarm suffix         | Priority | Runbook                                                           |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `-dlq.fifo-not-empty` | P1       | [Dead-Letter Queue Not Empty](./dead-letter-queue.md)            |
| `-error-rate`        | P2       | [Lambda Errors or Duration](./lambda-errors-duration.md)          |
| `-queue-depth`       | P2       | [Queue Backlog](./queue-backlog.md)                               |
| `-duration-p95`      | P3       | [Lambda Errors or Duration](./lambda-errors-duration.md)          |

### Symptom-driven

| Runbook                                                    | Use it when                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Verify Environment Health](./verify-environment-health.md) | You need to confirm an environment is healthy after a deploy, or find out why it isn't                   |
| [UNS Dispatch Failures](./uns-dispatch-failures.md)        | Notifications aren't reaching the GOV.UK app, or logs show `UNS error` / mTLS failures                    |
| [Travel Ingestion Stale](./travel-ingestion-stale.md)      | Travel advice changed on GOV.UK but no event was recorded                                                |
| [Digest Not Sent](./digest-not-sent.md)                    | A daily or weekly digest is missing, partial or duplicated (the digest feature is not currently in use)   |
| [Fix Forward](./fix-forward.md)                            | You need to ship a corrective change during a live incident and want to choose the right path            |

---

## Runbook template

```markdown
# <Situation> Runbook

For `<alarm name>` / <symptom>.

| | |
| --- | --- |
| **Impact** | What users experience |
| **Urgency** | How quickly to act, and why |
| **First action** | The one thing to do first |

```bash
export ENV=development   # or staging
```

---

## Step 1: <identify/confirm>

## Step 2: <investigate>

## Step 3 onward: <mitigate, escalate, or resolve>

---

## After recovery

1. Confirm the alarms have cleared and stayed clear for an agreed settling period.
2. Raise follow-up work for anything the incident exposed.
3. Feed anything you learned under pressure back into this runbook.

---

## Related

**Guides:** ...
**Code:** ...
```

Ground every runbook in real alarm names, real file paths and real thresholds taken from the code. A runbook that describes an alarm or threshold that doesn't exist in the code is worse than no runbook.

---

## Related

**Guides:**

- [Documentation Guide](../documentation-guide.md)
- [Architecture](../architecture.md)
- [Deployment Guide](../deployment.md)
- [Infrastructure Development Guide](../infrastructure-development.md)
