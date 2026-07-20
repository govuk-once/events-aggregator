# Events Aggregator v2 — Analysis

Based on architecture discussion with UNS tech lead (July 2026).

## What changed from v1

| Concern | v1 (current branch) | v2 (agreed direction) |
|---------|---------------------|----------------------|
| Schedules | ASAP + Daily + Weekly | ASAP only |
| Digest rollups | Built into this service | Deferred to UNS (not our problem) |
| Notification model | One message per schedule per country | One message per change per country |
| Output | Publish to UNS topic | Publish to UNS (one notification per change) |
| Country feed | Not in scope | New: API serving change history per country |
| Storage | Stateless (no persistence) | S3 bucket (projected view of changes per country) |
| Consumer | UNS only | UNS + Flex (country page feed) |

## What events-aggregator v2 does

### 1. Poll for changes (ASAP only)

Single scheduler detects changes as they happen. On each change detected for a supported country:
- Fire one notification to UNS (one change = one notification, same as DVLA model)
- Update the country's change feed in S3

### 2. Maintain a change feed per country

Every poll cycle, snapshot the current change history for each changed country into S3. This becomes the source of truth for the country page's "recent changes" view.

- Written to S3 (scales to millions of reads from the app)
- One object per country (e.g. `changes/pakistan.json`)
- Contains the recent change history (timestamp + note, ordered by date)

### 3. Serve a read API for Flex

Flex calls an API to get a country's change feed for the country page. Two endpoints:

- `GET /countries/{slug}/changes` — changes for one country
- `GET /countries/changes` — all countries' changes (TBD: payload size concern)

The API reads from S3, not from GOV.UK at request time. This decouples read traffic from the upstream polling.

## What events-aggregator v2 does NOT do

| Responsibility | Owner | Why not us |
|----------------|-------|-----------|
| Daily/weekly digest rollups | UNS | UNS already needs to solve this for all sources (DVLA, DWP, Home Office). Can't be done per-source because a user subscribes to multiple sources. |
| Subscription management | UNS | User subscribes via the app; UNS owns the subscription list |
| Notification centre UX | UNS / Flex | Rolling up multiple country notifications into one entry is a presentation decision |
| Push notification routing | UNS / OneSignal | We fire the notification; UNS decides how to deliver |

## Product decisions confirmed

1. **Subscription is on/off per country** — no frequency choice in v1. User subscribes or doesn't.
2. **No rollups in events-aggregator** — if Spain, Cyprus, and Greece all change on the same day, that's 3 separate notifications to UNS. UNS decides whether to batch them for the user.
3. **Country feed is user-facing** — available on the country page so users can see what's changed before deciding to subscribe.
4. **Deep linking** — each change entry links to the relevant GOV.UK travel advice page.
5. **Accept edge cases** — multiple rapid changes to the same country may produce multiple notifications. Low risk, accepted.
6. **S3 for read path** — the change feed is written to S3 so it can scale to millions of app requests without hitting GOV.UK or DynamoDB.

## What survives from v1

| Module | Status |
|--------|--------|
| `ChangesAdapter` interface | Keeps — still the seam for data fetching |
| `getChangesForWindow` (GOV.UK adapter) | Keeps — still the polling mechanism |
| `resolveCountry` / country mapping | Keeps — still filters supported countries |
| `buildMessage` | **Simplifies** — no schedule in the message, no digest wording. Just one change = one notification |
| `publishToUns` / SigV4 signing | Keeps — same transport |
| `requireEnvVars` / security hardening | Keeps |
| EventBridge schedule | Keeps (one schedule instead of three) |
| Daily/weekly schedules | **Removed** |
| `messageBuilder` dedup marker | Keeps — still prevents duplicate notifications for the same change |
| Simulate script | Keeps — still useful for dry-run testing |

## New components needed

| Component | Purpose |
|-----------|---------|
| S3 bucket (CDK) | Store per-country change feed JSON |
| S3 writer | After detecting changes, write updated feed to S3 |
| API Gateway + Lambda (or S3 direct) | Serve the feed to Flex |
| Simplified `buildMessage` | One change = one notification (no "3 changes in the daily digest" wording) |

## Open questions

1. **S3 object structure** — one JSON file per country (`changes/pakistan.json`) or a single large file? Per-country is simpler and scales better for single-country reads.
2. **Feed depth** — how many changes to keep in the feed? Last 20? Last 6 months? All time? Affects object size.
3. **API Gateway vs S3 presigned URLs vs CloudFront** — how does Flex actually read the feed? Direct S3 with CloudFront is simplest and cheapest at scale.
4. **Notification content** — does the notification include a deep link to the GOV.UK page, or to our feed view? Product decision.
5. **Payload size for "all countries' changes"** — 226 countries × N changes each. May need pagination or be dropped from v1 API.

## Timeline context

- UX designs needed in 2-3 weeks to unblock mobile development
- v1 target: ~4 weeks
- Rollups and AI-driven messaging deferred beyond 4-6 week scope
