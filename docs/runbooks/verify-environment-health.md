# Verify Environment Health

How to confirm that an Events Aggregator environment is healthy after a deploy, or when something seems wrong but no alarm has fired.

---

Every check is read-only. Before you start, get credentials (`aws:sandbox` for development, PR and personal stacks; `aws:staging` for staging).

For CLI checks, set your target environment first:

```bash
export ENV=development   # or staging, pr-<n>, or your $USER
```

---

## Quick check (5 minutes)

### 1. The stack is deployed at the expected version

**AWS Console:**
CloudFormation → **Stacks** → search for `${ENV}-events-aggregator-stack` → check **Status** is `UPDATE_COMPLETE` (or `CREATE_COMPLETE`) and that the `Version` tag matches the latest `main.yml` run.

**CLI:**
```bash
aws cloudformation describe-stacks --stack-name ${ENV}-events-aggregator-stack \
  --query "Stacks[0].{Status:StackStatus,Updated:LastUpdatedTime,Version:Tags[?Key=='Version']|[0].Value}"
```

Expect `UPDATE_COMPLETE` (or `CREATE_COMPLETE`) and a `Version` matching the latest `main.yml` run.

---

### 2. No alarms are firing

**AWS Console:**
CloudWatch → **Alarms** → **In alarm** → filter by `${ENV}-` to scope to this environment.

**CLI:**
```bash
aws cloudwatch describe-alarms --state-value ALARM \
  --query "MetricAlarms[?contains(AlarmName, '${ENV}-')].[AlarmName,StateUpdatedTimestamp]" --output table
```

Anything listed goes to the [runbook index](./README.md).

---

### 3. Recent activity looks normal

**AWS Console:**
CloudWatch → **Dashboards** → `${ENV}-events-aggregator-overview`. Check:

- `travel-ingestion` runs about once an hour, with no errors.
- `eventProcessing` and `single-event` invocations follow travel changes. They can be zero on a quiet day.

There is no CLI equivalent — open the dashboard for a visual overview.

---

### 4. Slack has been quiet (development and staging only)

Check the operational alerts channel for alarms and the release channel for the latest deploy announcement.

If all four checks pass, the environment is healthy. Otherwise, work through [What to check](#what-to-check).

---

## What to check

### Schedules

**AWS Console:**
EventBridge → **Rules** → filter by `${ENV}-ebschedule-`. Confirm three `*TravelSchedule` rules are all **Enabled**.

**CLI:**
```bash
aws events list-rules --name-prefix ${ENV}-ebschedule- \
  --query "Rules[].[Name,State,ScheduleExpression]" --output table
```

Expect three `*TravelSchedule` rules, all `ENABLED`. The two digest rules belong to a feature that isn't in use.

---

### Queues

**AWS Console:**
SQS → **Queues** → find `${ENV}-sqsevents-incoming-events.fifo` and `${ENV}-sqsevents-incoming-events-dlq.fifo`. Check **Messages Available** for both.

**CLI:**
```bash
for q in incoming-events incoming-events-dlq; do
  url=$(aws sqs get-queue-url --queue-name ${ENV}-sqsevents-${q}.fifo --query QueueUrl --output text)
  echo "$q: $(aws sqs get-queue-attributes --queue-url $url --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages --output text)"
done
```

Expect both to be at or near 0. Anything in the DLQ is a P1: see [Dead-Letter Queue](./dead-letter-queue.md).

---

### Data

**AWS Console:**
DynamoDB → **Tables** → `${ENV}-dynamotable-sourceStore` → **Overview** tab → **Item count**.

**CLI:**
```bash
aws dynamodb describe-table --table-name ${ENV}-dynamotable-sourceStore --query "Table.ItemCount"
```

Expect roughly 226 countries (`ItemCount` refreshes about every 6 hours). A count near 0 means seeding failed. Re-run the seed job.

---

### Configuration

**AWS Console:**
Systems Manager → **Parameter Store** → search by path `/ea-runner/`. Open each parameter and check its value. Any value ending in `-placeholder` for `uns-api-url`, `uns-mtls-*`, or `uns-kms-key-arn` breaks UNS delivery.

**CLI:**
```bash
aws ssm get-parameters-by-path --path /ea-runner/ --query "Parameters[].[Name,Value]" --output table
```

Look for any value that still ends in `-placeholder`. A placeholder `uns-api-url`, `uns-mtls-*` or `uns-kms-key-arn` breaks UNS delivery. Placeholder Slack values just mean Slack isn't connected.

---

## Resolve or escalate

- A firing alarm: follow its runbook.
- A UNS-side problem: the UNS team.
- Flex unable to read travel data: check the `FlexTravelReadRole` trust (account and external ID) and that the `flex-travel-config` secret and KMS key policies haven't drifted. Then contact the Flex team.

---

## Non-production only: live invocation

You can invoke the ingestion Lambda directly to exercise the full notification pipeline. Understand what happens before you do:

**Change detection is based on live GOV.UK data, not `sourceStore`.**
The Lambda queries the GOV.UK search and content APIs for countries whose `change_history` falls within the schedule window (`triggeredAt` minus the schedule duration). `sourceStore.lastUpdated` is not used for filtering — it is only updated as a side effect.

**`debugSuffix` bypasses both idempotency layers.**
The suffix is appended to `change.note` before the `eventID` hash is computed (`sha256([namespace, group, timestamp, note])`). A different `eventID` passes the `attribute_not_exists(eventID)` condition on `eventsStore`, so the event is written even if the same real change was already processed. The `GroupNotificationID` sent to UNS is derived from the stored `DynamoEvent` (which includes `eventNote`), so UNS also sees it as new and dispatches the notification. This means `debugSuffix` will re-send notifications for any country that already went through the pipeline — by design, to force the path through when idempotency would otherwise short-circuit it.

**Real notifications are sent.**
If GOV.UK has countries that changed within the window, all their subscribers receive push notifications and message-centre entries. Without `debugSuffix`, previously processed changes are skipped by DynamoDB idempotency. With it, they fire again. Either way, only use this in a development or personal sandbox.

### Invoking

Use `schedule: "hourly"` to minimise the window and limit how many countries are in scope.

**AWS Console:**
Lambda → **Functions** → `${ENV}-eventsaggregator-travel-ingestion` → **Test** tab. Create a test event:

```json
{
  "triggeredAt": "<current ISO timestamp>",
  "schedule": "hourly",
  "debugSuffix": " [smoke test]"
}
```

Click **Test** and check the **Execution results** and **Log output** for errors.

**CLI:**
```bash
aws lambda invoke --function-name ${ENV}-eventsaggregator-travel-ingestion \
  --payload "{\"triggeredAt\":\"$(date -u +%FT%TZ)\",\"schedule\":\"hourly\",\"debugSuffix\":\" [smoke test]\"}" \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

### Checking execution without triggering notifications

To confirm the Lambda is running correctly without dispatching anything, inspect the most recent scheduled invocation in CloudWatch Logs:

**AWS Console:**
CloudWatch → **Log groups** → `/aws/lambda/${ENV}-eventsaggregator-travel-ingestion` → open the latest log stream and confirm it completed without errors.

**CLI:**
```bash
aws logs tail /aws/lambda/${ENV}-eventsaggregator-travel-ingestion --since 2h
```

---

## Related

- [Deployment Guide](../deployment.md)
- [Infrastructure Development Guide](../infrastructure-development.md)
- [Runbooks index](./README.md)
