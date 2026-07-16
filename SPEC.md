## Problem Statement

Users need timely notifications when GOV.UK travel advice changes for countries they care about. Currently there is no mechanism to detect changes and push them to subscribers at their preferred frequency (hourly, daily, or weekly digests).

## Solution

A stateless Lambda-based service that polls the GOV.UK Search and Content APIs on three schedules, detects which supported countries have changed, builds notification messages from the change history, and publishes them to the appropriate UNS topic for delivery.

## User Stories

1. As a subscriber, I want to receive a notification when travel advice changes for a country I follow, so that I'm aware of new risks or requirements.
2. As a subscriber, I want to choose whether I receive hourly, daily, or weekly digests per country, so that I control notification volume.
3. As a subscriber, I want the notification to contain the change description (not just "something changed"), so that I can decide whether to read the full page.
4. As an operator, I want the service to be stateless and serverless, so that there's minimal infrastructure to manage.
5. As an operator, I want structured log output when a Content API call fails after retries, so that I can identify persistent issues.
6. As an operator, I want structured log output when an unknown content_id appears, so that I can decide whether to add it to the supported list.
7. As an operator, I want the service to continue processing other countries when one Content API call fails, so that a single upstream issue doesn't block all notifications.
8. As an operator, I want the mapping table to use content_id as the stable key, so that country renames don't silently break the service.
9. As an operator, I want to deploy the full stack (Lambda, EventBridge rules, IAM) via CDK, so that infrastructure is versioned and repeatable.
10. As a future developer, I want the message-building and topic-derivation logic separated from the polling logic, so that switching to a RabbitMQ event source later requires minimal rework.

## Implementation Decisions

- **Runtime**: Single AWS Lambda function triggered by three EventBridge scheduled rules (hourly, daily, weekly). Each rule passes an input constant: `{"schedule": "hourly"|"daily"|"weekly"}`.
- **Time window derivation**: The schedule input maps to a lookback duration (1 hour, 1 day, 1 week). The `from` timestamp is calculated as `now - duration`. Missed runs are accepted as a known gap in v1 — downstream schedules act as a safety net.
- **Step 1 — Search API**: `GET /api/search.json?filter_content_store_document_type=travel_advice&filter_public_timestamp=from:{window}&order=-public_timestamp&count=300&fields[]=link&fields[]=title&fields[]=public_timestamp`. Returns all travel advice pages changed in the window (max ~226).
- **Step 2 — Mapping lookup**: Each result's content_id is checked against an in-code mapping table. Known + supported countries proceed. Unknown content_ids are logged as structured events and skipped.
- **Step 3 — Content API**: For each supported changed country, `GET /api/content/foreign-travel-advice/{slug}` to retrieve `details.change_history`. Rate-limited to 10 requests/second (GOV.UK's published limit). Retry with backoff up to 3 times on failure; skip on exhaustion and log the error. Other countries continue processing.
- **Step 4 — Message building**: Extract change_history entries that fall within the time window. Build notification body from the change descriptions.
- **Step 5 — Topic derivation and publish**: Topic format is `travel-advice.{our-slug}.{frequency}`. Publish message to UNS via cross-account API call with SigV4 signature.
- **Mapping table**: In-code dictionary keyed on GOV.UK content_id, mapping to `{our_slug, display_name, supported: bool}`. Deployed with the Lambda. Will migrate to a database when the RabbitMQ event source is introduced.
- **Lambda timeout**: 60 seconds (worst case: 226 calls at 10/sec = ~23s, plus retry overhead).
- **Infrastructure**: CDK stack containing the Lambda, three EventBridge rules, IAM role with permissions for the cross-account UNS API call.

## Testing Decisions

- **Seam**: The Lambda handler function is the single test seam. Given an event input and stubbed external dependencies (GOV.UK APIs, UNS client), the full logic is exercisable through one entry point.
- **What makes a good test**: Tests exercise external behaviour — given a schedule input and a set of API responses, assert the correct messages are published to the correct topics. Do not test internal implementation details like how the rate limiter batches calls.
- **Key test scenarios**:
  - Happy path: Search returns 3 countries, all supported, Content API succeeds, 3 messages published to correct topics.
  - Partial failure: One Content API call fails after retries, the other countries still publish.
  - Unknown country: Search returns a content_id not in the mapping — logged, not published.
  - No changes: Search returns empty results — no Content API calls, no messages.
  - Window calculation: Each schedule input produces the correct `from` timestamp.
  - Rate limiting: Respects 10/sec constraint (can verify call timing or batch size).

## Out of Scope

- **Stored state**: No database, no "last successful run" tracking. Missed windows are accepted.
- **Deduplication**: Users subscribe to one frequency per country; no cross-schedule dedup needed.
- **RabbitMQ event source**: Future architecture. The service will be reworked when this arrives — current design avoids painting into a corner but does not pre-build for it.
- **Alerting/alarms on unknown countries**: Will be wired up via CloudWatch metric filters later. v1 logs to stdout/stderr only.
- **Overlapping window or gap recovery**: Not implemented in v1.
- **UNS topic pre-creation**: Topics are handled lazily by UNS.
- **Retention or history**: No stored event history. The service is fire-and-forget.

## Further Notes

- The GOV.UK Content API rate limit is 10 requests/second per client. The service must respect this.
- The endpoint `https://www.gov.uk/api/content/foreign-travel-advice` returns all ~226 countries with their latest `change_description` in one call. This was considered as an alternative to the Search API approach but doesn't eliminate the per-country Content API calls when full `change_history` is needed.
- When GOV.UK adds a new country or changes a content_id (e.g. Turkey → Türkiye with a new content_id), the unknown-country log event surfaces this for manual decision. The operator then updates the mapping table and deploys.
- The message-building and topic-derivation logic should be extractable as a module, since it will survive the future architecture change to RabbitMQ + DB.
