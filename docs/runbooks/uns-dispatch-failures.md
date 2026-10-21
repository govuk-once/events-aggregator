# UNS Dispatch Failures Runbook

For when notifications aren't reaching the GOV.UK app because calls to UNS are failing.

| | |
| --- | --- |
| **Impact** | Instant notifications fail and are discarded after 3 retries |
| **Urgency** | High. Every new travel advice change is affected |
| **First action** | Classify the failure as configuration, credentials, payload or UNS itself |

```bash
export ENV=development   # or staging
```

---

## Step 1: confirm

Look for `P2-…-single-event-error-rate`, and for `Error from uns api` in the logs. Logs Insights on `/aws/lambda/${ENV}-eventsaggregator-single-event`:

```text
fields @timestamp, message, result.error.status, result.error.message, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

---

## Step 2: classify

| Evidence                                                   | Cause                                       | Action                                                          |
| ---------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `SSM parameter not found`                                  | A parameter is missing                      | Restore it through `SSM_PARAMETERS_TO_UPDATE` ([SSM parameters](../infrastructure-development.md#ssm-parameters)) |
| `secret is empty…` / `does not contain a PEM block`        | A secret is empty or malformed              | Correct the secret value                                        |
| `AccessDeniedException` (Secrets Manager or KMS)           | The SSM ARNs don't match the real secrets or key | Correct them, then redeploy                                |
| TLS handshake errors / `ECONNRESET`, no HTTP status        | The certificate has expired or isn't trusted | Check expiry (below) and contact the UNS team                  |
| `401` / `403`                                              | Wrong API key                               | Write the UNS-issued key into `ea-${ENV}/uns-api-key`           |
| `400`                                                      | UNS rejected the payload                    | Check recent deploys. [Fix forward](./fix-forward.md)           |
| `5xx`, connect timeouts                                    | UNS is degraded                             | Escalate through standard incident process

To check certificate expiry:

**AWS Console:**
Systems Manager → **Parameter Store** → `/ea-runner/uns-mtls-cert-arn` to get the secret ARN. Then Secrets Manager → search for that ARN → open the secret → **Retrieve secret value**. Copy the PEM block and run `openssl x509 -noout -enddate` locally to check the expiry date.

**CLI:**
```bash
CERT_ARN=$(aws ssm get-parameter --name /ea-runner/uns-mtls-cert-arn --query Parameter.Value --output text)
aws secretsmanager get-secret-value --secret-id "$CERT_ARN" --query SecretString --output text \
  | sed 's/\\n/\n/g' | openssl x509 -noout -enddate
```

Corrected values take effect within 10 minutes without a deploy (see [Architecture: UNS](../architecture.md#uns-outbound)).

---

## Step 3: find the events that weren't sent

Events whose instant notification failed have no `processingStatus.instant`:

**AWS Console:**
DynamoDB → **Tables** → `${ENV}-dynamotable-eventsStore` → **Explore items** → select index `namespace-timestamp-query`, set `namespace = travel` and `eventTimestamp >= <incident start>`, add a filter on `processingStatus.instant` **Attribute not exists**, then **Run**.

**CLI:**
```bash
aws dynamodb query --table-name ${ENV}-dynamotable-eventsStore \
  --index-name namespace-timestamp-query \
  --key-condition-expression "#n = :ns AND eventTimestamp >= :since" \
  --filter-expression "attribute_not_exists(processingStatus.instant)" \
  --expression-attribute-names '{"#n":"namespace"}' \
  --expression-attribute-values '{":ns":{"S":"travel"},":since":{"S":"<incident start>"}}' \
  --projection-expression "compositeKey, eventTimestamp"
```

There's no automatic resend. Agree with the product owner whether to resend by hand, because a late "instant" alert may do more harm than none.

---

## After recovery

1. The error-rate alarm is `OK`, and a new change produces a successful `single-event` log.
2. Record the number of unsent notifications in the incident ticket.

---

## Related

- [`src/single-event/README.md`](/src/single-event/README.md)
- [`src/utils/uns-client.ts`](/src/utils/uns-client.ts)
