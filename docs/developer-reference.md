# Developer Reference

What you need to know before changing Lambda or utility code. For how the pieces connect at runtime, read [Architecture](./architecture.md) first.

---

## Overview

```text
src/
├── travel-ingestion/    one directory per Lambda, each with index.ts (handler) and a README
├── event-processing/
├── single-event/
├── aggregated-event/
├── services/            sourceStore access
├── types/               shared types (IncomingEvent, DynamoEvent, Source, NotificationPayload)
└── utils/               UNS client, SSM cache, SQS publishing, payload builders, observability
```

[`build-lambdas.mjs`](/build-lambdas.mjs) bundles each directory to `dist/<dir>/index.js`, and the stack loads `dist/<dir>` as that Lambda's code. **Renaming a Lambda directory means changing the stack too.** Imports use the `@/*` alias for `src/*`.

---

## Handler patterns

Follow the existing Lambda that has the same trigger type.

### Scheduled handlers (`travel-ingestion`, `aggregated-event`)

EventBridge passes `{ "triggeredAt": "<time>", "schedule": "hourly | daily | weekly" }`. The handler turns that into a look-back window (`getStartTime` / `getDigestStartTime`). It returns `false` when there's nothing to do, returns `true` on success, and rethrows on failure so that EventBridge retries. Metrics are flushed in `finally`.

### Batch handlers (`event-processing`, `single-event`)

These use Powertools `BatchProcessor` with `processPartialResponse`, so one bad record doesn't fail the whole batch:

```typescript
const processor = new BatchProcessor(EventType.SQS); // or EventType.DynamoDBStreams
export const handler: SQSHandler = async (event, context) =>
  processPartialResponse(event, recordHandler, processor, { context });
```

Throw from `recordHandler` to fail a record. Return normally to acknowledge it, including records you deliberately skip (duplicates, non-`INSERT` stream events).

---

## Calling UNS

Follow the pattern in [`src/single-event/index.ts`](/src/single-event/index.ts): read the URL and PEM secret ARNs with `getParameter`, read the API key with `getSmmSecret`, then build a client with `createUnsMtlsClientFromSecrets`. Where each value lives is listed in [Architecture: UNS](./architecture.md#uns-outbound).

`sendToSubscribers` doesn't throw on an HTTP error. It returns `ApiResult`, so always check `result.ok`.

To give a new Lambda access to UNS, call `grantUnsAccess(fn, …)` in the stack and set the `SSM_PREFIX` and `UNS_API_KEY_ARN` environment variables.

---

## Notification payloads

`getNotificationPayload` in [`src/utils/index.ts`](/src/utils/index.ts) builds the instant payloads. `single-event` sends two for each event:

| `Subgroup` | `Channel`                                  |
| ---------- | ------------------------------------------ |
| `instant`  | `PUSH_NOTIFICATION_AND_MESSAGE_CENTRE`     |
| `none`     | `MESSAGE_CENTRE_ONLY`                      |

Both deep-link to the country's travel advice page through `govuk://app.gov.uk/web?url=…`.

---

## Errors

Handlers throw a plain `Error` with a searchable message:

| Message                                                            | Lambda              | Meaning                                    |
| ------------------------------------------------------------------ | ------------------- | ------------------------------------------ |
| `Search api returned a <status>` / `Content api returned a <status>` | travel-ingestion  | A GOV.UK API failed                        |
| `Error sending event to SQS`                                       | travel-ingestion    | `SendMessage` failed                       |
| `Unable to parse the SQS payload`                                  | event-processing    | The message body isn't JSON                |
| `UNS error` / `UNS error: <status> — <message>`                    | single-event / aggregated-event | UNS returned a non-2xx response |
| `SSM parameter not found: /ea-runner/<key>`                        | UNS callers         | Missing configuration                      |
| `secret is empty or not a string` / `does not contain a PEM block` | UNS callers         | A missing or malformed secret              |

---

## Adding a new event source

The data model is namespaced (`namespace/group`), but the code only handles `travel`. A new source needs:

1. An ingestion Lambda that writes `IncomingEvent`s with a deterministic `eventID` to the existing queue.
2. Seeded `sourceStore` rows under the new namespace.
3. Updates to `getNotificationPayload`, `buildDigestPayload` and the `aggregated-event` query, which are all hardcoded to `travel`.
4. Schedules, plus an entry in the `lambdas` list passed to `StandardServiceAlarmsFactory` and in the dashboard.

---

## Related

- [Architecture](./architecture.md)
- [Infrastructure Development Guide](./infrastructure-development.md)
- [Unit testing conventions](/src/README.md)
