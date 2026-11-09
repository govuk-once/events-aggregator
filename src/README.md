## Unit testing conventions

Unit tests sit next to the code they test. There's no separate `test/` directory. Vitest is configured in [`vitest.config.ts`](../vitest.config.ts) with `globals: true` and the `@/*` alias resolved through `vite-tsconfig-paths`.

```sh
pnpm run test           # every *.test.ts in the repo, including scripts/
pnpm run test:unit      # src/ only, with v8 coverage
pnpm run test:watch
pnpm vitest run src/aggregated-event/index.test.ts   # one file
```

### File naming and location

- Name tests `<subject>.test.ts` and put them next to the subject. For example, `src/utils/sqs.ts` is tested by `src/utils/sqs.test.ts`, and a Lambda's `index.ts` is tested by `index.test.ts` in the same directory.
- Tests for scripts live beside the script (`scripts/seed-travel-events-source.test.ts`).
- `*.test.ts` files are excluded from coverage and from `tsconfig.json`'s compile set.

### Structure

- Use one top-level `describe('<Lambda or module>')` per file.
- Write `it(...)` names as a behaviour sentence, for example `it('should return false and log when no sources are found in the database')`.
- Reset every mock in `beforeEach` / `afterEach`: `dynamoMock.reset()`, `sqsMock.reset()`, `nock.cleanAll()`.

### Mocking conventions

- **AWS SDK v3:** use [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock), and mock the document client rather than the low-level one:

  ```typescript
  const dynamoMock = mockClient(DynamoDBDocumentClient);
  dynamoMock.on(PutCommand).resolves({});
  ```

- **Outbound HTTP:** GOV.UK APIs and UNS are intercepted with [`nock`](https://github.com/nock/nock). Call `nock.cleanAll()` after each test so an unused interceptor can't leak into the next one.
- **Powertools parameters and SSM:** mock these at module level with `vi.mock('@aws-lambda-powertools/parameters/secrets', …)` and `vi.mock('@aws-sdk/client-ssm', …)`, so no test reads real configuration.
- **Silencing Powertools logs:** spying on `console` doesn't work, because the Logger has its own console instance. Set the level before the module loads instead:

  ```typescript
  vi.hoisted(() => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
  });
  ```

### Coverage

Coverage is collected for `src/**` with the `v8` provider (text, json, html and lcov reporters) and uploaded to SonarQube by the `SonarScan` CI job.

### CDK tests

`pnpm run test:cdk` runs `*.test.ts` files under `cdk/`. The script uses `--passWithNoTests`. CDK tests should use `aws-cdk-lib/assertions` against a synthesised `EventsAggregatorStack`, with `FLEX_ACCOUNT_ID` / `FLEX_EXTERNAL_ID` set to dummy values.
