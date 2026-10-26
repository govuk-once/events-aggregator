# Idempotency and Deduplication

The hourly, daily, and weekly ingestion schedules have overlapping look-back windows, so the same GOV.UK change is frequently seen more than once. Three layers remove duplicates before a notification reaches a subscriber.

## The three layers

### 1. SQS FIFO content-based deduplication

`incoming-events.fifo` deduplicates identical message bodies within a 5-minute window. This catches a `travel-ingestion` retry queuing the same event seconds after the original.

### 2. DynamoDB conditional write

`eventProcessing` writes to `eventsStore` with `ConditionExpression: attribute_not_exists(eventID)`. A duplicate is silently discarded — it never reaches the DynamoDB stream and no notification fires.

`eventID` is `sha256(namespace|group|public_timestamp|note)`. It is deterministic: every sighting of the same GOV.UK change note produces the same hash, regardless of which schedule triggered ingestion or how many times the Lambda retried.

### 3. GroupNotificationID

`single-event` passes a `GroupNotificationID` to UNS, derived from `hashToUuidV4({ dbEntry, schedule, channel })`, where `dbEntry` includes `eventNote`. UNS uses this as an idempotency key and rejects a payload it has already dispatched.

---

## Why `startTime` is used for filtering, not `source.lastUpdated`

`travel-ingestion` updates `source.lastUpdated` to the newest `change_history` timestamp **before** it publishes to the queue. If the Lambda crashed between those two steps, using `source.lastUpdated` as the filter on the next run would silently skip the unqueued event — the window would no longer cover it. Using `startTime` instead means a retry always re-covers the window; layer 2 then drops any true duplicates. `source.lastUpdated` is observability state (visible to Flex and the dashboard), not a deduplication boundary.

---

## `debugSuffix` and idempotency

Appending `debugSuffix` to a change note changes the `eventID` hash (note is an input) and the `GroupNotificationID` hash (via `eventNote` in `dbEntry`). Both idempotency layers therefore treat the suffixed event as new, even if the original was already processed and notified. See the [smoke test guidance](./runbooks/verify-environment-health.md#non-production-only-live-invocation) for the operational implications. This is a testing only feature, not to be used in production environments.

---

## Related

- [Architecture: duplicate protection](./architecture.md#duplicate-protection)
- [Travel Ingestion](../src/travel-ingestion/README.md)
- [Event Processing](../src/event-processing/README.md)
