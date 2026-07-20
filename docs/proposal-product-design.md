# Travel Advice Notifications — Changes to Approach

## What changed

Originally we planned to build daily/weekly digests into events-aggregator. This broke the UNS contract (one notification = one message) because a digest bundles multiple countries into one notification. UNS will need to solve rollups cross-source anyway (DVLA, DWP, Home Office all face this), so we've agreed to keep events-aggregator simple: **one change detected = one notification fired.** UNS owns the presentation.

## The three changes

### 1. Events-aggregator fires individual notifications only

No scheduling, no digests, no rollups. When a country's travel advice changes, we fire one notification to UNS. Same model as DVLA. The data supports this — even the busiest country (Mexico) changes only once per week. Risk of message fatigue is low.

Digest and cadence features become a UNS platform capability in the future, applying across all government sources.

### 2. Country change feed (atom-style)

A per-country feed showing recent editorial change notes and dates. Serves as:
- A preview of what you'd receive if you subscribed
- The landing page when browsing a country's travel advice changes
- The place where the subscribe toggle lives

**Important limitation:** the feed entries are editorial notes (e.g. "Updated regional tensions information"). They describe *what section changed* but don't contain the actual advice.

### 3. Notification tap target — link to the web view

**Strong steer:** tapping a notification should take the user directly to the GOV.UK travel advice web page, not to the change feed. The feed tells you *that* something changed; the web view tells you *what* the change actually says. The user's intent after receiving a notification is to read the advice, not to see a list of headlines.

The change feed is for browsing and deciding whether to subscribe. The notification is for acting on a change.

---

## Capabilities

| Capability | In V1 | Managed by |
|------------|:-----:|------------|
| Detect travel advice changes (polling) | Yes | Events aggregator |
| Fire one notification per change to UNS | Yes | Events aggregator |
| Subscribe toggle (on/off per country) | Yes | Front-end app + UNS |
| Push notification delivery | Yes | UNS + OneSignal |
| Show notification in Notification Centre | Yes | UNS + Front-end app |
| Tap notification → GOV.UK web view | Yes | Front-end app |
| Country change feed (atom-style list) | No (V2) | Events aggregator + Front-end app |
| Frequency picker (daily/weekly/immediate) | No (V3) | UNS |
| Cross-source rollups and digests | No (V3) | UNS |

---

## Open product questions

1. **Should notifications appear in the Notification Centre?** Strong steer: yes — it's where users expect to find them, and it gives a history of what was sent.
2. **What does tapping a notification in the centre do?** Strong steer: same as the push — go to the GOV.UK web view. The change feed is a browse/subscribe surface, not a notification destination.
3. **How many countries do we enable at launch?** Could start with a subset (high-change countries) or all 226. Data suggests all is safe at this volume.
