# Dead-Letter Queue Not Empty Runbook

For `P1-<env>-sqsevents-incoming-events-dlq.fifo-not-empty`.

| | |
| --- | --- |
| **Impact** | Travel advice changes weren't stored, so no notification will be sent for them until they're redriven |
| **Urgency** | High. DLQ messages expire after 4 days |
| **First action** | Find out why `eventProcessing` failed. Don't redrive until the cause is fixed |

```bash
export ENV=development   # or staging
DLQ_URL=$(aws sqs get-queue-url --queue-name ${ENV}-sqsevents-incoming-events-dlq.fifo --query QueueUrl --output text)
```

---

## Step 1: size the problem

**AWS Console:**
SQS → **Queues** → click `${ENV}-sqsevents-incoming-events-dlq.fifo` → **Messages Available** in the queue details.

**CLI:**
```bash
aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages
```

One or two messages usually means a bad payload. A growing count means every message is failing. Check whether `P2-…-eventProcessing-error-rate` is also firing.

---

## Step 2: find the cause

Logs Insights on `/aws/lambda/${ENV}-eventsaggregator-eventProcessing`, for the few minutes before the alarm:

```text
fields @timestamp, message, eventId, compositeKey, error.name, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

| Log shows                                                   | Then                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `Unable to parse the SQS payload`                           | A producer bug. Fix it, then delete the poison messages (don't redrive them) |
| `AccessDeniedException` or a KMS error                      | An IAM or key policy regression. [Fix forward](./fix-forward.md), then redrive |
| Throttling                                                  | Usually transient. Redrive                                   |
| `Task timed out`, with no errors                            | Check X-Ray for slow DynamoDB calls, then redrive            |

To look at a message (it becomes visible again after 30 seconds):

**AWS Console:**
SQS → **Queues** → click the DLQ → **Send and receive messages** → **Poll for messages**. The message is hidden for 30 seconds while you inspect it.

**CLI:**
```bash
aws sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 1 --visibility-timeout 30
```

---

## Step 3: redrive

Once the cause is fixed, use **Start DLQ redrive → Redrive to source queue** in the SQS console, or:

```bash
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
aws sqs start-message-move-task --source-arn "$DLQ_ARN"
```

Redriving more than once is safe, because already-stored events are skipped. For a poison message, save its body in the incident ticket, then delete it.

---

## After recovery

1. The DLQ is empty and the alarm is `OK`.
2. The redriven events are in `eventsStore` with `processingStatus.instant` set. If not, see [UNS Dispatch Failures](./uns-dispatch-failures.md).

---

## Related

- [Architecture: failure semantics](../architecture.md#failure-semantics)
- [`src/event-processing/README.md`](/src/event-processing/README.md)
