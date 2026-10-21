# Travel Ingestion Stale Runbook

For when GOV.UK travel advice has changed but no event was recorded.

| | |
| --- | --- |
| **Impact** | Subscribers aren't told about the change |
| **Urgency** | Medium. Wider look-back windows often recover the change on their own |
| **First action** | Confirm the change exists upstream and is missing from `eventsStore` |

```bash
export ENV=development   # or staging
export SLUG=<country slug, e.g. myanmar>
```

This usually starts from a user report or a spot check, because a disabled schedule or source doesn't raise an alarm.

---

## Step 1: confirm it's missing

First, confirm the change exists on GOV.UK:

```bash
curl -s https://www.gov.uk/api/content/foreign-travel-advice/${SLUG} | jq '.details.change_history[0]'
```

Then check whether the event is in `eventsStore`:

**AWS Console:**
DynamoDB → **Tables** → `${ENV}-dynamotable-eventsStore` → **Explore items** → select index `timestamp-query`, set `compositeKey = travel/<slug>` and `eventTimestamp >= <public_timestamp>`, then **Run**.

**CLI:**
```bash
aws dynamodb query --table-name ${ENV}-dynamotable-eventsStore --index-name timestamp-query \
  --key-condition-expression "compositeKey = :k AND eventTimestamp >= :t" \
  --expression-attribute-values '{":k":{"S":"travel/'${SLUG}'"},":t":{"S":"<public_timestamp>"}}'
```

If the event is already in `eventsStore`, ingestion worked. Go to [UNS Dispatch Failures](./uns-dispatch-failures.md).

---

## Step 2: find where it was dropped

Check that `${ENV}-ebschedule-*TravelSchedule` rules are enabled and that `travel-ingestion` is invoked about once an hour. Then run Logs Insights on `/aws/lambda/${ENV}-eventsaggregator-travel-ingestion`:

```text
fields @timestamp, message, schedule, startTime
| filter message like /^No / or level = "ERROR"
| sort @timestamp desc
| limit 50
```

| Log shows                                    | Meaning and action                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `No travel changes found`                    | The search index is lagging. A later, wider window usually picks the change up |
| `No sources detected`                        | `sourceStore` is missing the country. Re-run the seed job                |
| No log for that country                      | Its source row has `sourceEnabled = false`                               |
| `No country changes detected in content API` | The change is older than every window. Backfill (Step 3)                 |
| `Search api…` / `Content api returned…`      | GOV.UK errors. Retries and later runs cover it                           |
| `Error sending event to SQS`                 | An SQS or KMS permissions problem                                        |

To check a source row:

**AWS Console:**
DynamoDB → **Tables** → `${ENV}-dynamotable-sourceStore` → **Explore items** → select index `composite-query`, set `compositeKey = travel/<slug>`, then **Run**.

**CLI:**
```bash
aws dynamodb query --table-name ${ENV}-dynamotable-sourceStore --index-name composite-query \
  --key-condition-expression "compositeKey = :k" --expression-attribute-values '{":k":{"S":"travel/'${SLUG}'"}}'
```

---

## Step 3: backfill

A weekly run looks back 7 days from `triggeredAt`. Running it again is safe, because duplicates are skipped:

**AWS Console:**
Lambda → **Functions** → `${ENV}-eventsaggregator-travel-ingestion` → **Test** tab. Create a test event with `{"triggeredAt": "<ISO timestamp>", "schedule": "weekly"}` and click **Test**.

**CLI:**
```bash
aws lambda invoke --function-name ${ENV}-eventsaggregator-travel-ingestion \
  --payload "{\"triggeredAt\":\"$(date -u +%FT%TZ)\",\"schedule\":\"weekly\"}" \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

Each newly stored event sends a real instant notification, so agree with the product owner before you backfill old changes.

---

## Related

- [`src/travel-ingestion/README.md`](/src/travel-ingestion/README.md)
- [Deployment Guide: pipeline](../deployment.md#pipeline) (seed job)
