# Runbook: Rotate UNS API Key

---

## Overview

The UNS API key is used within the `travel-ingestion`, `single-event`, and `aggregated-event` lambdas to the UNS notification service (along with mtls certificates). It lives in AWS Secrets Manager at `ea-<env>/uns-api-key` and is injected into each lambda as the `UNS_API_KEY_ARN` environment variable. The lambda reads the secret at invocation and caches it for **10 minutes** (via `@aws-lambda-powertools/parameters`).

---

## Key locations

| Thing | Value |
|---|---|
| SM secret name | `ea-<env>/uns-api-key` (e.g. `ea-development/uns-api-key`) |
| How lambdas get it | `UNS_API_KEY_ARN` env var → `getSmmSecret()` at runtime |
| Lambda cache TTL | 10 minutes — a warm lambda may use the old key for up to 10 min after rotation |
| GitHub secret that triggers update | `SM_SECRETS_TO_UPDATE` (environment-scoped) |

---

## Rotate via deployment

Use this path for routine rotation. The predeploy script writes the new value to Secrets Manager as part of the normal deploy pipeline.

### 1. Obtain the new key

Request a new API key from the UNS team. Do **not** invalidate the old key yet.

### 2. Update the GitHub environment secret

In GitHub → **Settings → Environments → `<environment>`**:

1. Find or create the secret `SM_SECRETS_TO_UPDATE`.
2. Set its value to a JSON object with the new key:
   ```json
   {"uns-api-key": "<new-key-value>"}
   ```
3. Save. The secret is now scoped to that environment — repeat for each environment being rotated.

> **If `SSM_PARAMETERS_TO_UPDATE` already exists in the same environment**, merge the objects rather than replacing the variable — each secret key is independent.

### 3. Trigger a deployment

Push a commit or manually trigger the workflow. The predeploy step runs `pnpm run cdk:predeploy`, which:

1. Iterates `SM_SECRETS_TO_UPDATE` and validates each key against `configurableSecrets` in [`cdk/cdk.predeploy.ssm.ts`](../../cdk/cdk.predeploy.ssm.ts).
2. Calls `PutSecretValueCommand` for each matched key.
3. Logs `Secret updated: uns-api-key` on success, or `Failed to update secret: uns-api-key` on error.

Check the **Pre-deploy SSM parameter setup** step in the workflow run for confirmation.

### 4. Verify (see [Verification](#verification))

### 5. Revoke the old key

Once verification passes, tell the UNS team to revoke the previous key.

### 6. Clear the GitHub secret (optional)

To avoid the key persisting in GitHub secrets longer than necessary, update `SM_SECRETS_TO_UPDATE` to `{}` after the rotation is complete and re-deploy (this is a no-op for the script).

## Verification

After rotation, confirm the new key is working:

**Check CloudWatch Logs** for the `travel-ingestion`, `single-event`, and `aggregated-event` lambdas. Look for successful UNS calls and the absence of `Error from uns api` entries:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/<env>-events-aggregator-single-event" \
  --filter-pattern '"Error from uns api"' \
  --start-time $(date -d '15 minutes ago' +%s000) \
  --region eu-west-2
```

An empty result is the expected good outcome. Any `UNS error` entries logged after rotation indicate the new key is not accepted by UNS — proceed to [Rollback](#rollback).

**Check the `travel-ingestion` schedule** — it fires every 15 minutes. One clean invocation after rotation is sufficient to confirm the key works for that lambda.

---

## Rollback

If the new key is rejected by UNS and calls are failing:

1. Reinstate the previous key in Secrets Manager either via portal of via the flow above.
2. If the old key was already revoked, ask UNS to issue an interim key.
3. Update the GitHub `SM_SECRETS_TO_UPDATE` secret to match whatever is now in Secrets Manager.
4. Monitor CloudWatch until errors clear (allow up to 10 minutes for cache expiry).

---

## Related

- [`cdk/cdk.predeploy.ssm.ts`](../../cdk/cdk.predeploy.ssm.ts) — predeploy script that writes the secret
- [`src/utils/index.ts`](../../src/utils/index.ts) — `getSmmSecret()`, the runtime reader
- [`cdk/stacks/events-aggregator-stack.ts`](../../cdk/stacks/events-aggregator-stack.ts) — `UnsApiKeySecret` construct, `UNS_API_KEY_ARN` env var wiring
- [`.github/workflows/_build_deploy.yml`](../../.github/workflows/_build_deploy.yml) — pipeline step that calls the predeploy script
