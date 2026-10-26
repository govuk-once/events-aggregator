# Events Aggregator

The Events Aggregator watches GOV.UK for changes that users have asked to be told about and sends them to the [GDS Unified Notification Service](https://github.com/govuk-once/gds-unified-notification-service) (UNS), which delivers them to the GOV.UK app. Today it has one event source: **foreign travel advice**. When the Foreign, Commonwealth & Development Office (FCDO) updates a country's travel advice, subscribers get an instant push notification.

---

## About the project

```text
EventBridge (hourly/daily/weekly)
        │
        ▼
travel-ingestion ──► incoming-events.fifo ──► eventProcessing ──► eventsStore (DynamoDB)
   │  (GOV.UK search + content APIs)                                   │ stream
   ▼                                                                    ▼
sourceStore (DynamoDB)                                            single-event ──► UNS (instant)

EventBridge (daily/weekly) ──► aggregated-event ──► eventsStore ──► UNS (digest, not in use)
```

The Flex platform also reads `sourceStore` and `eventsStore` across accounts, so the app can list countries and their recent changes. The [Architecture](docs/architecture.md) guide has the full picture.

### Built with

- [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/home.html) (TypeScript) for infrastructure
- Node.js 24 Lambdas bundled with esbuild
- [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/latest/) for logging, metrics, tracing and batch processing
- DynamoDB, SQS (FIFO), EventBridge, Secrets Manager, SSM Parameter Store, SNS and Amazon Q Developer in chat applications (Slack alerts)
- Vitest, ESLint, Prettier, pre-commit, checkov and SonarQube

---

## Installation

The full walkthrough, including AWS access and troubleshooting, is in the [Environment Setup](docs/environment-setup.md) guide. In short:

```bash
mise install          # node, pnpm, checkov, pre-commit, detect-secrets
pnpm install
pre-commit install    # done automatically by mise's postinstall hook
```

---

## Development

```bash
pnpm run test            # all tests (test:unit / test:cdk / test:watch also available)
pnpm run lint:check      # lint:fix to auto-fix
pnpm run format:check    # format:fix to auto-fix
pnpm run types:check
pnpm run build           # bundle Lambdas into dist/
pre-commit run --all-files
```

The pre-commit hooks in [`.pre-commit-config.yaml`](.pre-commit-config.yaml) run secret detection, lint, format, type checks, tests, the build, `cdk synth` and checkov on every commit. Test conventions are in [`src/README.md`](src/README.md).

---

## Deployment

Every PR gets its own `pr-<n>` stack. Merges to `main` are released and deployed to development and then staging. Production deployment is coming soon. See the [Deployment Guide](docs/deployment.md) and [Releases and Versioning](docs/releases.md).

---

## Documentation

| Guide                                                              | Read it when                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                               | You want to understand how events flow through the service     |
| [Environment Setup](docs/environment-setup.md)                     | You're setting up a machine for the first time                 |
| [Developer Reference](docs/developer-reference.md)                 | You're changing Lambda or utility code                         |
| [Infrastructure Development](docs/infrastructure-development.md)   | You're changing the CDK stack, alarms or SSM parameters        |
| [Deployment](docs/deployment.md)                                   | You're deploying, or a pipeline has failed                     |
| [Releases and Versioning](docs/releases.md)                        | You want to know how a version number is chosen                |
| [Runbooks](docs/runbooks/README.md)                                | An alarm has fired or something is broken                      |
| [Documentation Guide](docs/documentation-guide.md)                 | You're adding or changing documentation                        |

Each Lambda also has its own README: [`travel-ingestion`](src/travel-ingestion/README.md), [`event-processing`](src/event-processing/README.md), [`single-event`](src/single-event/README.md) and [`aggregated-event`](src/aggregated-event/README.md).

---

## Dependency management

Dependabot opens weekly grouped PRs for npm and GitHub Actions minor and patch updates, with a 7-day cooldown (see [`.github/dependabot.yml`](.github/dependabot.yml)). pnpm also refuses packages published less than 7 days ago (`minimumReleaseAge` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml)).

---
