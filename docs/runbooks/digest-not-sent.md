# Digest Not Sent Runbook

> The digest feature is not currently in use. This is a stub, to be expanded when the feature launches.

For a daily or weekly digest that is missing, incomplete or duplicated.

- **How it works:** see [`src/aggregated-event/README.md`](/src/aggregated-event/README.md). Events are marked as sent only after UNS accepts the digest, so a failure before the send is safe to retry, but a failure while marking can cause duplicates.
- **Logs:** run Logs Insights on `/aws/lambda/<env>-eventsaggregator-aggregated-event` and filter on `message like /aggregated-event/`. `UNS dispatch failed` points to [UNS Dispatch Failures](./uns-dispatch-failures.md).
- **Re-run** once the cause is fixed. Only unmarked events inside the window are sent:

**AWS Console:**
Lambda → **Functions** → `${ENV}-eventsaggregator-aggregated-event` → **Test** tab. Create a test event with `{"triggeredAt": "<ISO timestamp>", "schedule": "daily"}` and click **Test**.

**CLI:**
```bash
export ENV=development   # or staging
aws lambda invoke --function-name ${ENV}-eventsaggregator-aggregated-event \
  --payload "{\"triggeredAt\":\"$(date -u +%FT%TZ)\",\"schedule\":\"daily\"}" \
  --cli-binary-format raw-in-base64-out /dev/stdout
```
