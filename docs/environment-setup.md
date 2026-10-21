# Environment Setup

How to get from a fresh machine to running tests and deploying a personal sandbox stack.

---

## Prerequisites

You need [mise](https://mise.jdx.dev/) (or nvm plus pnpm), gds-cli for AWS access, and the AWS CLI v2. Tool versions are pinned in [`.nvmrc`](/.nvmrc), `packageManager` in [`package.json`](/package.json), and [`mise.toml`](/mise.toml).

`engine-strict=true` in [`.pnpmrc`](/.pnpmrc) means `pnpm install` refuses to run on the wrong Node or pnpm version.

### Using mise (recommended)

```bash
mise trust
mise install      # node + pnpm from .nvmrc/package.json, plus checkov, pre-commit, detect-secrets
pnpm install
```

mise's `postinstall` hook runs `pre-commit install` for you, and `node_modules/.bin` is added to your `PATH`, so you can type `cdk` directly.

---

## AWS credentials

### Through gds-cli

[`mise.toml`](/mise.toml) defines shell aliases for the two accounts:

| Alias               | Effect                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `aws:sandbox`       | Exports credentials for `once-events-aggregator-development-admin`           |
| `aws:sandbox:web`   | Opens the development account console                                        |
| `aws:staging`       | Exports credentials for `once-events-aggregator-staging-admin`               |
| `aws:staging:web`   | Opens the staging account console                                            |

The development account hosts `development`, every `pr-<n>` stack and every personal sandbox.

### Verify access

**AWS Console:**
IAM → **Dashboard** shows your current identity (account, user or role). CloudFormation → **Stacks** → search for `events-aggregator` to see deployed stacks and their status.

**CLI:**
```bash
aws sts get-caller-identity
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName,'events-aggregator')].StackName"
```

---

## Personal sandbox

Your sandbox is named after `$USER` unless you set `ENVIRONMENT`. For example, if `USER=jdoe`, the stack is `jdoe-events-aggregator-stack`. Sandboxes:

- share the account and the `/ea-runner/*` SSM parameters with `development`,
- get no Slack integrations,
- use `RemovalPolicy.DESTROY`, so `cdk destroy` removes everything.

```bash
aws:sandbox
export FLEX_ACCOUNT_ID=<from the development GitHub environment variables>
export FLEX_EXTERNAL_ID=<from the development GitHub environment variables>

pnpm run build
pnpm run cdk:deploy
```

Seed your empty `sourceStore` so `travel-ingestion` has countries to check:

```bash
Environment=$USER npx tsx scripts/seed-travel-events-source.ts \
  --service dynamotable --table-name sourceStore --dry-run   # remove --dry-run to write
```

To enable only a few countries, set `COUNTRY_SOURCES_ENABLED='["france","spain"]'`. Run the script with `--help` to see every option.

Your sandbox gets its own `ea-<you>/uns-api-key` secret with a generated value. To send to UNS from your sandbox, copy a real key into it. Ingestion and persistence work without it.

Fast iteration: `pnpm run dev` runs `tsc -w` alongside `cdk watch --hotswap`.

Tear down when you're finished:

```bash
pnpm run cdk:destroy
```

---

## Troubleshooting

| Symptom                                                   | Fix                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Flex Account id and external id not set`                 | Export `FLEX_ACCOUNT_ID` and `FLEX_EXTERNAL_ID` (dummy values are fine for `cdk synth`) |
| `Unable to determine environment`                         | Set `ENVIRONMENT=<name>` (some shells, such as containers, have no `USER`)          |
| `pnpm install` engine error                               | Run `mise install` to get the pinned Node and pnpm versions                         |
| `pnpm install` refuses a just-released package            | `minimumReleaseAge` blocks packages less than 7 days old. Wait, or pin an older version |
| Pre-commit fails on `cdk-synth` / `checkov`               | Make sure checkov is installed (`mise install`)                                     |

---

## Related

**Guides:**

- [Deployment Guide](./deployment.md)
- [Infrastructure Development Guide](./infrastructure-development.md)
