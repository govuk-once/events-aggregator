# Infrastructure Development Guide

How the CDK app is put together: environments, resource names, alarms, Slack and SSM parameters. Read this before changing anything under [`cdk/`](/cdk).

---

## Overview

| File                                                                                | Responsibility                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`cdk/stacks/events-aggregator-stack.ts`](/cdk/stacks/events-aggregator-stack.ts)   | Every resource, IAM grant and stack output                         |
| [`cdk/constants/environments.ts`](/cdk/constants/environments.ts)                   | Environment detection and naming rules                             |
| [`cdk/cdk_constructs/`](/cdk/cdk_constructs)                                        | Resource factories with secure defaults                            |
| [`cdk/cdk.predeploy.ssm.ts`](/cdk/cdk.predeploy.ssm.ts)                             | Seeds the `/ea-runner/*` SSM parameters before a deploy            |

Synthesis needs `FLEX_ACCOUNT_ID` and `FLEX_EXTERNAL_ID`. Dummy values work for a local synth:

```bash
FLEX_ACCOUNT_ID="000000000" FLEX_EXTERNAL_ID="000000000" pnpm run cdk synth
```

---

## Environments and naming

The environment is `ENVIRONMENT`, falling back to `$USER`. It decides three things:

| Rule                         | Applies to                                                        | Effect                                            |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| `isSandboxEnvironment()`     | Anything other than `dev`/`development`, `test`/`testing`, `stag`/`staging`, `prod`/`production` | No Slack integrations   |
| `isPullRequestEnvironment()` | `pr-<n>`                                                          | Tagged as ephemeral                               |
| `isEphemeralEnvironment()`   | Anything other than `stag` or `prod`                              | Data resources use `RemovalPolicy.DESTROY`        |

### Resource names

| Resource     | Name                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| Stack        | `<env>-events-aggregator-stack`                                                               |
| Lambdas      | `<env>-eventsaggregator-{travel-ingestion, eventProcessing, single-event, aggregated-event}`  |
| Queues       | `<env>-sqsevents-incoming-events.fifo`, `<env>-sqsevents-incoming-events-dlq.fifo`            |
| Tables       | `<env>-dynamotable-sourceStore`, `<env>-dynamotable-eventsStore`                              |
| Schedules    | `<env>-ebschedule-{HOURLY,DAILY,WEEKLY}TravelSchedule`, `<env>-ebschedule-{DAILY,WEEKLY}DigestSchedule` |
| SNS topics   | `<env>-events-aggregator-{operational-alerts, release-notifications}`                         |
| Dashboard    | `<env>-events-aggregator-overview`                                                            |

The middle segment comes from the name each factory is constructed with in the stack. The seed jobs in the workflows hard-code the table names, so a rename must update [`main.yml`](/.github/workflows/main.yml) and [`pull_request.yml`](/.github/workflows/pull_request.yml) too.

---

## Retry defaults that matter operationally

The factories set these defaults, and the [Architecture: failure semantics](./architecture.md#failure-semantics) table depends on them:

| Factory                      | Default                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `SqsQueueFactory`            | DLQ after 3 receives, 4-day retention                                     |
| `DynamoDbTableFactory`       | Stream consumer: 3 retries, bisect on error, `onFailure` only if passed   |
| `EventBridgeScheduleFactory` | `rate()` schedules, 2 retries, maximum event age 2 hours                  |

Because schedules are `rate()`-based, they count from the last time the rule was deployed, not from a fixed clock time.

---

## CloudWatch alarms

[`StandardServiceAlarmsFactory`](/cdk/cdk_constructs/StandardServiceAlarmsFactory.ts) applies one set of thresholds to all four Lambdas, the incoming queue and its DLQ. Every alarm publishes to the `operational-alerts` topic.

| Alarm name                                               | Fires when                                  | Runbook                                                           |
| -------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `P1-<env>-sqsevents-incoming-events-dlq.fifo-not-empty`  | Any message in the DLQ (1 min)              | [Dead-Letter Queue](./runbooks/dead-letter-queue.md)              |
| `P2-<function>-error-rate`                               | Error rate > 1% (5 min)                     | [Lambda Errors or Duration](./runbooks/lambda-errors-duration.md) |
| `P2-<env>-sqsevents-incoming-events.fifo-queue-depth`    | More than 100 visible messages (5 min)      | [Queue Backlog](./runbooks/queue-backlog.md)                      |
| `P3-<function>-duration-p95`                             | p95 duration > 5000 ms (5 min)              | [Lambda Errors or Duration](./runbooks/lambda-errors-duration.md) |

P1 means messages have been lost to processing, P2 means a service is failing or falling behind, and P3 means it's degrading. If you change a threshold, update this table and the runbooks that quote it.

---

## Slack notifications

| Topic                   | Published by                                                              | Channel SSM keys (`/ea-runner/…`)                       |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `operational-alerts`    | CloudWatch alarms                                                         | `alerts-slack-workspace-id`, `alerts-slack-channel-id`  |
| `release-notifications` | The deploy workflow ([`_build_deploy.yml`](/.github/workflows/_build_deploy.yml)) | `release-slack-workspace-id`, `release-slack-channel-id` |

A Slack channel (Amazon Q Developer in chat applications) is created only outside sandboxes, and only once both of its SSM values have been changed from `<key>-placeholder`. To connect one, set the real IDs through `SSM_PARAMETERS_TO_UPDATE` and redeploy.

---

## SSM parameters

Every parameter lives under `/ea-runner/`, which is **shared by every stack in the account**: sandboxes and PR stacks read the same values as `development`.

[`cdk.predeploy.ssm.ts`](/cdk/cdk.predeploy.ssm.ts) runs before each pipeline deploy. It creates any parameter that's missing, and overwrites a parameter only when it appears in the `SSM_PARAMETERS_TO_UPDATE` GitHub variable (a JSON object such as `{"uns-api-url":"https://…"}`). The UNS parameters are described in [Architecture: UNS](./architecture.md#uns-outbound).

The UNS API key secret (`ea-<env>/uns-api-key`) is created by the stack with a generated value. In a new environment, write the key issued by UNS into it after the first deploy.

---

## Security scanning

Checkov scans `cdk.out` in the pre-commit hook and in CI. Skipped checks and the baseline are in [`.checkov.yaml`](/.checkov.yaml) and [`.checkov.baseline`](/.checkov.baseline).

---

## Related

- [Architecture](./architecture.md)
- [Deployment Guide](./deployment.md)
- [Runbooks](./runbooks/README.md)
