# CLAUDE.md

This file guides Claude Code (claude.ai/code) when it works with code in this repository.

## Project Overview

Events Aggregator is a serverless service for GOV.UK, built on AWS. It polls GOV.UK for travel advice changes, stores each change as an event, and sends notifications through the GDS Unified Notification Service (UNS) to the GOV.UK app:

- **Instant.** Each new event in the `eventsStore` table triggers a push notification and a message-centre entry through the DynamoDB stream.
- **Digest (not currently in use).** A daily or weekly schedule groups unprocessed events by country and sends one message per country.

The Flex platform reads the `sourceStore` and `eventsStore` tables cross-account through `FlexTravelReadRole`.

## Commands

```sh
pnpm install                 # install dependencies
pnpm run build               # esbuild bundle src/**/*.ts → dist/
pnpm run types:check         # tsc --noEmit
pnpm run lint:check          # eslint (lint:fix to fix)
pnpm run format:check        # prettier (format:fix to fix)
pnpm run test                # all vitest tests, run once
pnpm run test:unit           # src/ tests with coverage
pnpm run test:cdk            # cdk/ tests
pnpm run cdk:synth           # synthesise CloudFormation (needs FLEX_ACCOUNT_ID and FLEX_EXTERNAL_ID set)
pnpm run cdk:diff            # diff against the deployed stack
```

Run a single test file:

```sh
pnpm vitest run src/travel-ingestion/index.test.ts
```

Synthesise without real Flex values (this is what the pre-commit hook does):

```sh
FLEX_ACCOUNT_ID="000000000" FLEX_EXTERNAL_ID="000000000" pnpm run cdk synth
```

## Architecture

### Source layout

- `src/travel-ingestion/` runs on an EventBridge schedule, polls the GOV.UK search and content APIs, and queues changes.
- `src/event-processing/` consumes the SQS FIFO queue and writes events to `eventsStore` (idempotent on `eventID`).
- `src/single-event/` consumes the `eventsStore` DynamoDB stream and sends instant notifications to UNS.
- `src/aggregated-event/` runs on an EventBridge schedule and sends daily or weekly digests to UNS (not currently in use).
- `src/services/eventSources.ts` holds the `sourceStore` queries.
- `src/utils/` holds shared helpers: the UNS mTLS client, the SSM cache, SQS publishing, event status updates, Powertools observability and X-Ray segments.
- `src/types/` holds shared types (`IncomingEvent`, `DynamoEvent`, `Source`, `NotificationPayload`).
- `scripts/seed-travel-events-source.ts` seeds `sourceStore` with every country from GOV.UK.

### Infrastructure layout

- `cdk/events-aggregator.ts` is the CDK app entrypoint. It creates one stack, `<env>-events-aggregator-stack`.
- `cdk/stacks/events-aggregator-stack.ts` defines every resource.
- `cdk/cdk_constructs/` holds the resource factories (Lambda, SQS, DynamoDB, EventBridge, SNS/Slack, dashboard, alarms).
- `cdk/constants/environments.ts` handles environment detection, resource name prefixes and Slack SSM keys.
- `cdk/cdk.predeploy.ssm.ts` seeds the `/ea-runner/*` SSM parameters before deploy.

The environment name comes from `ENVIRONMENT`, falling back to `$USER`. It prefixes every resource name.

### Path aliases

```text
@/* → src/*
```

## Testing

- **Framework:** Vitest, with tests colocated as `*.test.ts`.
- **AWS SDK mocking:** `aws-sdk-client-mock`.
- **HTTP mocking:** `nock`.
- Silence Powertools logs in tests by setting `POWERTOOLS_LOG_LEVEL=SILENT` inside `vi.hoisted`.

## Commit Convention

Format: `type(TICKET): subject`, for example `feat(NOT-559): add digest metrics`.

- **Types:** `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`
- **Scope:** an upper-case ticket reference such as `NOT-123`.

The PR title is validated by `.github/workflows/_validate_pr.yml`. PRs are squash-merged, so the title becomes the release commit. Full rules are in `docs/releases.md`.

## Safety

- Never run `cdk deploy`, `cdk destroy`, the `deploy:*` or `destroy:*` scripts, `cdk:predeploy`, the seed script, or any AWS CLI command that mutates resources unless the user explicitly asks for it. Read-only commands such as `cdk synth` and `cdk diff` are fine.
- Never target `staging` or `prod` without explicit confirmation.
- Never commit or log secrets: UNS mTLS certificates and keys, API keys, the Flex external ID, or AWS credentials.
- Don't change `SEED_NAMESPACE` in `scripts/seed-travel-events-source.ts`. It is the identity of every seeded row.

## Code Style

- Prettier: single quotes, semicolons, trailing commas everywhere, 80-character lines.
- ESLint: typescript-eslint (`eslint.config.mts`).
- TypeScript 6 via the `@typescript/typescript6` alias.
