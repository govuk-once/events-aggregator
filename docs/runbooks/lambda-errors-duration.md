# Lambda Errors or Duration Runbook

For `P2-<function>-error-rate` and `P3-<function>-duration-p95`. Thresholds are in [CloudWatch alarms](../infrastructure-development.md#cloudwatch-alarms).

| | |
| --- | --- |
| **Impact** | Depends on the function (see Step 1) |
| **Urgency** | P2: now. P3: during working hours, unless it's escalating into errors |
| **First action** | Work out which function fired, then check whether it started right after a deploy |

---

## Step 1: route by function

| Function            | What's affected                                                   | Go to                                                 |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `travel-ingestion`  | New travel advice changes aren't being picked up                  | [Travel Ingestion Stale](./travel-ingestion-stale.md) |
| `eventProcessing`   | Events are retrying and may reach the DLQ                         | [Dead-Letter Queue](./dead-letter-queue.md)           |
| `single-event`      | Instant notifications are failing                                 | [UNS Dispatch Failures](./uns-dispatch-failures.md)   |
| `aggregated-event`  | Digest (not in use)                                               | [Digest Not Sent](./digest-not-sent.md)               |

The scheduled functions run rarely, so a single failed run counts as a 100% error rate and fires the alarm.

---

## Step 2: read the errors

```text
fields @timestamp, level, message, error.message
| filter level = "ERROR" or @message like /Task timed out/
| sort @timestamp desc
| limit 50
```

Run this on `/aws/lambda/<env>-eventsaggregator-<function>`, and match the message against the [errors table](../developer-reference.md#errors). If the errors started right after a deploy (see the `release-notifications` channel), go to [Fix Forward](./fix-forward.md).

---

## Step 3: duration (P3)

- Open the function's X-Ray trace map and find the slow subsegment or SDK call.
- Slow GOV.UK APIs show up in `travel-ingestion`, which fetches countries one at a time.
- Slow UNS shows up in `single-event`.

A P3 that persists usually turns into `Task timed out` errors.

---

## After recovery

1. The alarm is `OK` and has stayed `OK` for one full schedule cycle (for the scheduled functions).
2. Check for lost work: DLQ messages and unsent instant notifications.

---

## Related

- [Architecture: failure semantics](../architecture.md#failure-semantics)
