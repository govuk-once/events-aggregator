## Event Aggregator

The events aggregator manages the dispatching of events to the GOV.UK app


## Setup

### Prerequisites

- detect-secrets (for secret detection)

### Installation

1. Install dependencies:

```bash
pnpm install
```


## Testing

Within this project there are multiple ways of triggering tests, there are also various flags that can adjust certain configurations to provide additional flexibility during development:

```sh
# Standard unit tests
pnpm run test

# Unit tests reporting coverage
pnpm run test:coverage
```

### Linting

To run the linting checks run


```sh
# Standard lint check
pnpm run lint:check

# To auto fix linting errors
pnpm run lint:fix
```

### Prettier Formatting

To run the prettier formatting

```sh
# Standard format check
pnpm run format:check

# To auto fix formatting errors
pnpm run format:fix
```

### Pre-commit Hooks

The project uses pre-commit hooks to maintain code quality. Hooks run automatically on `git commit`:

**On every commit:**

- Trailing whitespace removal
- End-of-file fixing
- YAML/JSON validation
- Large file detection
- Merge conflict detection
- Private key detection
- **Secret detection** (passwords, API keys, tokens via `detect-secrets`)
- Prettier formatting
- ESLint linting
- TypeScript type checking

## pre-commit

To run all hooks manually:

```bash
# Run all pre-commit hooks
pre-commit run --all-files

# Run specific hook
pre-commit run eslint --all-files
pre-commit run detect-secrets --all-files
```

# Running a local build

```bash
# Run all pre-commit hooks
pnpm build
```

## Deployment

Deployments are managed through github workflows, workflow will ensure quality checks run on every PR and when code is merged to ``main`` branch the latest version will be deployed to the development environment.

### Local Deployment

You can deploy locally to test your code in the aws environment the repo automatically manages adding your username to the stack to create a ephemeral environment for testing your changes.

```bash
# run cdk deployment
pnpm cdk:deploy
```




### Travel Alerts

The Travel alerts lambda checks the GOV.UK content api's for updates to travel advice before dispatching those updates to UNS to trigger app notifications
