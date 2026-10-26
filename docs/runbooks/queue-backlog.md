# Queue Backlog Runbook

For `P2-<env>-sqsevents-incoming-events.fifo-queue-depth`: more than 100 visible messages.

| | |
| --- | --- |
| **Impact** | Notifications are delayed. Nothing is lost yet: messages are kept for 4 days |
| **Urgency** | Medium. Check whether the queue is draining before you act |
| **First action** | Compare messages arriving with messages processed |

`eventProcessing` reads one message at a time with up to 5 concurrent invocations. Messages for the same country are processed strictly in order, so a burst for one country drains one message at a time.

---

## Step 1: is the queue draining?

On the `<env>-events-aggregator-overview` dashboard and the queue's SQS metrics (`NumberOfMessagesSent`, `NumberOfMessagesDeleted`, `ApproximateAgeOfOldestMessage`):

| Pattern                                                  | Meaning                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| A spike after a travel run, and depth falling            | A normal burst. Keep watching                                        |
| Few or no deletes, `eventProcessing` errors high         | Processing is failing. See [Lambda Errors](./lambda-errors-duration.md) and [DLQ](./dead-letter-queue.md) |
| Few or no deletes, no invocations                        | The SQS trigger is disabled. Check the Lambda's **Triggers** tab     |
| Few or no deletes, `Task timed out`                      | DynamoDB is slow or throttling                                       |

---

## Step 2: mitigate

- **Failures:** fix the cause. The failing messages will move to the DLQ either way.
- **Trigger disabled:** re-enable it, and find out who disabled it and why.
- **Genuine volume across many countries:** raise `maxConcurrency` in [`events-aggregator-stack.ts`](/cdk/stacks/events-aggregator-stack.ts) through a [fix forward](./fix-forward.md).

---

## After recovery

1. The queue depth alarm is `OK`.
2. The DLQ is empty, or is being handled.

---

## Related

- [`src/event-processing/README.md`](/src/event-processing/README.md)
