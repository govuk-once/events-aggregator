# Travel Advice Notifications — Product Proposal

This document captures an evolution in our thinking about how travel advice notifications are delivered. Our original approach assumed digests (daily, weekly, ASAP) would be built into the events aggregator service. Through technical discovery and conversations with the UNS team, we've identified a simpler model that still delivers incrementally — but with different consequences for some design decisions.

---

## What changed in our thinking

Our original plan included daily and weekly digests as a first-class feature of events-aggregator. When we dug in, two things surfaced:

1. **Weekly digests should contain multiple countries' updates in a single notification.** If you subscribe to Spain, Cyprus, and Greece, and all three change on the same day, a weekly digest should bundle those — not send three separate digest messages. This broke the contract we'd pencilled between events-aggregator and UNS, because one "notification" from us would contain many messages, and UNS's model (shared with all of government) is: one notification = one message.

2. **UNS will need to solve this problem anyway.** As more services come online (DVLA, DWP, Home Office, document mailbox), users will want to control how they receive messages from *all* sources — not just travel. Rolling up across sources, managing cadence, and reducing noise is a platform-level UNS feature, not something each source service should solve independently.

Given this, we've agreed to **remove scheduling from events-aggregator** and simplify to: detect a change, fire one notification, let UNS handle everything downstream.

---

## Before (original approach)

- Three schedules in events-aggregator: ASAP, daily, weekly
- Digest logic built into our service
- Topic-based publishing with frequency in the topic name
- UNS receives pre-rolled-up messages

### Problems with this approach

- One "digest notification" containing multiple countries' changes doesn't fit UNS's one-notification-one-message contract
- Every other government service sending to UNS would need to solve the same rollup problem independently
- If the user subscribes to multiple sources, they'd still get separate digests from each — not a unified experience

---

## Now (revised approach)

Events-aggregator detects changes and fires **one notification per change per country** — the same model DVLA uses. No batching, no scheduling logic in this service.

```
GOV.UK publishes a change to Pakistan travel advice
    ↓
Events aggregator detects the change (polling every ~15 minutes)
    ↓
Fires one notification to UNS: "Pakistan travel advice updated"
    ↓
UNS stores it, delivers push notification, shows in Notification Centre
```

### What the user sees

- A push notification: **"Pakistan travel advice updated"**
- The notification in their Notification Centre
- Tapping it takes them to the GOV.UK travel advice web page for that country

---

## Why this works (for now)

**The data shows the update cadence is low.** Over the last year across 226 countries:

- The busiest country (Mexico) changed ~once per week
- A user subscribed to 5 countries would get ~3 notifications per week
- There is no realistic scenario where a typical user is overwhelmed

We can prove this with real data over time. If the volume becomes a problem, UNS builds the cadence/rollup feature — which it needs anyway for the broader platform. Meanwhile, we ship value now.

### Why not keep scheduling "just in case"?

If we build scheduling into events-aggregator, we commit to a direction that won't evolve well:
- When UNS adds cross-source rollups, our per-source rollups become redundant or conflicting
- We'd need to unpick the digest logic later
- The scheduling code adds complexity for a problem that doesn't exist yet at this volume

Better to ship the simple version, measure, and let UNS own the presentation layer.

---

## Consequences for design decisions

| Decision | Impact |
|----------|--------|
| Subscribe toggle | Unchanged — on/off per country |
| Frequency picker (daily/weekly/ASAP) | **Removed from V1** — user subscribes or doesn't |
| Notification content | One change note per notification (not a bundled digest) |
| Notification tap target | Opens GOV.UK web view for that country |
| Country change feed (atom-style) | **New addition** — users can preview changes before subscribing |
| Rollup/cadence controls | **Deferred to UNS** — will apply across all government sources |

---

## New addition: Country Change Feed

There's a desire for the country page to show an RSS-style feed of recent changes. This serves two purposes:

1. **Discovery:** users can see what kind of notifications they'd receive *before* they subscribe
2. **Reference:** users can check what changed at any time without relying on push notifications

### What this looks like

When you tap a country in the list, you see a feed of editorial change notes (e.g. "Updated information about regional tensions") with dates. Each entry can link through to the GOV.UK web page where the actual detail lives.

### Important context

These are editorial notes entered by content teams when they make changes. They describe *what* changed but don't contain the advice itself. The value to the user is:
- **Preview:** "Ah, this country gets updated regularly — worth subscribing to"
- **Context:** "I got a notification yesterday — let me see what it was about"
- **Action:** tap through to the web view for the full detail

The feed on its own doesn't replace the web view. There should be a clear path (per-item link or a button at the top) to reach the actual content.

### Technical requirement

Events-aggregator would maintain this feed by writing a snapshot of each country's changes to S3 on each poll cycle. The app reads from S3 (via CloudFront), so it scales to millions of users without additional infrastructure.

---

## Evolutionary path

### V1 — Notifications (MVP, ~4 weeks)

**What ships:**
- Subscribe toggle (on/off) per country on the country page
- Push notification on each change: "Pakistan travel advice updated"
- Notification visible in the Notification Centre
- Tapping the notification opens the GOV.UK travel advice web page
- No atom feed, no cadence choice, no rollups

**What we measure:**
- Subscription rate per country
- Notification open rate
- Impact on travel advice page views
- Unsubscribe rate (signal for message fatigue)

**A/B test opportunity:** Enable for a subset of users to measure engagement lift vs control group.

---

### V2 — Country Change Feed

**What ships:**
- "Recent changes" feed visible on the country page (atom-style list)
- Each entry shows the editorial change note and date
- Entries link to the relevant GOV.UK travel advice page for full detail
- User can browse the feed without subscribing
- Subscribe toggle appears alongside the feed

**What we learn:**
- Does showing the feed increase subscription conversion?
- Are users satisfied with editorial change notes, or do they want more detail?
- How often do users return to the feed vs relying on push notifications?

**Design consideration:** The feed entries are editorial notes — they hint at what changed but don't contain the actual advice. The UI should make it obvious that tapping an entry takes you to the real content on GOV.UK.

---

### V3 — Cadence and Rollups (UNS platform feature)

**What ships (owned by UNS, not events-aggregator):**
- User can choose notification cadence: immediate, daily summary, weekly summary
- UNS rolls up messages across sources: "You have 3 travel updates and 1 DVLA reminder"
- Applies to all notification sources, not just travel
- Events-aggregator continues to fire individual events — UNS handles the presentation

**Why this is V3 and why UNS owns it:**
- As more government services come online (DVLA, DWP, Home Office, document mailbox), each will send messages to UNS
- Users will want control over *all* their notifications, not just travel
- Rolling up across sources is a platform capability — building it per-source duplicates effort and creates inconsistent UX
- By the time V3 is needed, we'll have real usage data from V1/V2 to inform the design

---

## Summary

| | V1 | V2 | V3 |
|-|----|----|-----|
| **Core value** | Know when things change | See what's changing before you subscribe | Control how you hear about it |
| **Owner** | Events aggregator + UNS | Events aggregator (feed) + Flex (UI) | UNS (platform feature) |
| **Complexity** | Low | Medium | High |
| **Dependency** | UNS notification delivery | S3 + Flex API integration | UNS rollup engine (multi-source) |
| **Risk** | Low — proven model (DVLA) | Low — read-only, no new notification paths | Medium — cross-source logic, UX research needed |

### The evolutionary benefit

Nothing gets thrown away between versions:
- V1's notification pipeline stays exactly the same in V2 and V3
- V2's change feed exists independently of notifications — it's useful even without push
- V3 is additive on top of V1 — UNS learns to bundle what we're already sending

The architecture supports this because events-aggregator's job is simple and stable: **detect changes, fire notifications, maintain the feed.** Everything else — subscription management, delivery, rollups, cadence — belongs to the platform.
