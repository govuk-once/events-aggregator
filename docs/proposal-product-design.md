# Travel Advice Notifications — Product Proposal

A proposal for designers and product on how we deliver travel advice change notifications, why we made the decisions we did, and how the feature evolves incrementally.

---

## Before

Today, users who want to know when travel advice changes for a country they're visiting have two options:

1. **Check the GOV.UK page manually** — relies on the user remembering to look
2. **Subscribe to email alerts via GOV.UK** — generic, not integrated with the app, no control over frequency

There is no in-app notification when travel advice changes. Users travelling to high-risk countries have no proactive way to stay informed through the app.

---

## Now (what we've built)

A service that **detects changes to GOV.UK travel advice pages as they happen** and publishes notifications to UNS, which delivers them to subscribed users.

The model is simple: **one change to a country = one notification to its subscribers.** This is the same model DVLA uses — one event, one message. No batching, no digest logic in this service.

### How it works

```
GOV.UK publishes a change to Pakistan travel advice
    ↓
Events aggregator detects the change (polling every ~15 minutes)
    ↓
Fires one notification to UNS: "Pakistan travel advice updated"
    ↓
UNS delivers to all users subscribed to Pakistan
```

### What the user sees

- A push notification: **"Pakistan travel advice updated"**
- The notification in their Notification Centre
- Tapping it takes them to the GOV.UK travel advice web page for that country

---

## Rationale

### Why one notification per change, not daily/weekly digests?

**Digests are a cross-source UNS problem, not a per-source one.** A user might subscribe to:
- Travel advice for 3 countries
- DVLA reminders
- DWP updates
- Home Office correspondence

If each source rolls up its own messages independently, the user still gets 4+ separate digests per day. The better solution is for UNS to roll up *across sources* — "You have 5 updates today" — which it can only do centrally. We send individual events; UNS decides how to present them.

### Why S3 for the change feed?

The country page in the app will show a feed of recent changes (like an RSS reader). This could receive millions of requests when the app scales. S3 + CloudFront handles that without breaking a sweat — no database, no Lambda at read time, no scaling concern.

### Why not build everything at once?

Each version delivers standalone user value and generates real usage data. We learn from each release before committing to the next level of complexity.

---

## Evolutionary Benefit

Each version builds on the last. Nothing gets thrown away.

| Version | What's added | What we learn |
|---------|-------------|---------------|
| V1 | Notifications work, users engage | Do users actually want this? Open rates, subscription rates |
| V2 | Users can preview before subscribing | Does seeing the feed increase subscription conversion? |
| V3 | Users control their notification experience | Does cadence control reduce unsubscribes? |

The technical architecture supports this evolution without rework — the polling, change detection, and notification publishing are the same in all three versions. Each version adds a layer on top.

---

## Feature Roadmap

### V1 — Notifications (MVP, ~4 weeks)

**User story:** As a traveller, I want to be notified when travel advice changes for countries I care about, so I don't have to check manually.

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

**User story:** As a user considering subscribing, I want to see what kind of notifications I would receive, so I can make an informed decision.

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

**Important context:** The change notes are editorial summaries (e.g. "Updated information about regional tensions"). They describe *what changed* but don't contain the actual advice. The detail is always on the GOV.UK web page — the feed is a preview, not a replacement.

---

### V3 — Cadence and Rollups (UNS-owned)

**User story:** As a user subscribed to multiple sources, I want to control how often I'm interrupted, so I can stay informed without notification fatigue.

**What ships (in UNS, not events-aggregator):**
- User can choose notification cadence: immediate, daily summary, weekly summary
- UNS rolls up messages across sources: "You have 3 travel updates and 1 DVLA reminder"
- Applies to all notification sources, not just travel advice
- Events-aggregator continues to fire individual events — UNS handles the presentation

**What we learn:**
- Does cadence control reduce unsubscribes?
- What's the most popular cadence per source type?
- Do bundled notifications have higher or lower open rates?

**Why this is V3:** Rollups require UNS to understand message semantics across multiple government services. This is a general platform capability, not a travel-specific feature. Building it after V1/V2 means we have real usage data to inform the design.

---

## Summary

| | V1 | V2 | V3 |
|-|----|----|-----|
| **Core value** | Know when things change | See what's changing before you subscribe | Control how you hear about it |
| **Owner** | Events aggregator + UNS | Events aggregator (feed) + Flex (UI) | UNS (platform feature) |
| **Complexity** | Low | Medium | High |
| **Dependency** | UNS notification delivery | S3 + Flex API integration | UNS rollup engine (multi-source) |
| **Risk** | Low — proven model (DVLA) | Low — read-only, no new notification paths | Medium — cross-source logic, UX research needed |
