# Notification Volume and API Usage Report

Based on GOV.UK travel advice change history: 2025-07-17 to 2026-07-17 (1 year of live data).

## Summary

| Metric | Value |
|--------|-------|
| Total changes (all countries) | 1,791 |
| Countries with at least 1 change | 222 / 226 |
| Average changes per day | 4.9 |
| Average changes per week | 34 |
| Peak day | 211 (bulk template update) |
| Median day | 4 |

## Top 10 Most Active Countries

```
Mexico         ████████████████████████████████████████████ 42
Bolivia        █████████████████████████████████████████ 37
Pakistan       ███████████████████████████████████████ 35
Philippines    █████████████████████████████████ 29
Kuwait         ███████████████████████████████ 27
Ecuador        ██████████████████████████████ 26
Cuba           ████████████████████████████ 24
Portugal       ██████████████████████████ 22
Saudi Arabia   ██████████████████████████ 22
Bahrain        ██████████████████████████ 22
```

## Notification Volume Per Schedule

If a user subscribes to these countries, how many notifications would they receive?

| Country | Changes/yr | ASAP (per change) | Daily (days with digest) | Weekly (weeks with digest) |
|---------|-----------|-------------------|--------------------------|---------------------------|
| Mexico | 42 | 42 | 38 | 24 |
| Bolivia | 37 | 37 | 32 | 22 |
| Pakistan | 35 | 35 | 32 | 20 |
| Philippines | 29 | 29 | 24 | 18 |
| Kuwait | 27 | 27 | 25 | 18 |
| Ecuador | 26 | 26 | 24 | 22 |
| Cuba | 24 | 24 | 23 | 19 |
| Portugal | 22 | 22 | 22 | 19 |
| Saudi Arabia | 22 | 22 | 21 | 14 |
| Bahrain | 22 | 22 | 21 | 15 |
| **All 10 combined** | **286** | **286** | **~159** | **52** |

### What this means for a user subscribed to the top 10:

- **ASAP:** 286 notifications/year = ~6/week = less than 1/day
- **Daily:** digest on 44% of days (159 of 365)
- **Weekly:** digest every single week (52 of 52)

## Death by notification: subscribing to all 226 countries

Each country sends its **own** notification per schedule. Subscribing to all 226 means up to 226 separate notifications landing in your inbox per window — not one combined digest.

| Schedule | Total notifications/year | On a typical day | On the worst day | Days (or weeks) you'd hear from us |
|----------|------------------------:|-----------------:|-----------------:|------------------------------------:|
| ASAP | 1,791 | 5 notifications | 211 notifications | 306 of 365 days (83%) |
| Daily | 1,717 | 3 notifications | 207 notifications | 306 of 365 days (83%) |
| Weekly | 1,442 | — | — | 52 of 52 weeks (100%) |

### Breaking that down:

**ASAP:** ~5 push notifications per day on average. Manageable in isolation, but every single one is a separate country's alert — so your phone buzzes 5 times across the day with unrelated country updates.

**Daily:** You'd get a digest notification on 83% of days (306 of 365). On a typical day, 3 different countries send you a digest. On the peak day, 207 countries all updated at once — 207 separate notifications.

**Weekly:** Every single week of the year, you'd get notifications. A typical week: 22 separate country digests arrive. Peak week: 210 countries all fire a weekly digest simultaneously.

### The lesson:

Subscribing to all countries on any schedule is unusable. The UI should guide users toward subscribing to the countries they actually travel to (typically 1-5). At that scale, even ASAP is less than 1 notification per week per country.

## Changes Per Week (last year)

```
2025-W29 ████████████ 12
2025-W30 ████████████████████████████ 28
2025-W31 ██████████████████████████████████████████████████████████ 58
2025-W32 ████████████████████████████████████████████████████ 52
2025-W33 ████████████████████ 20
2025-W34 ██████████████████████████████ 30
2025-W35 ██████████████████████████████████ 34
2025-W36 ██████████████████████████████████████ 38
2025-W37 ████████████████████████ 24
2025-W38 ██████████████████████████████████████████ 42
2025-W39 ██████████████████████████████████████ 38
2025-W40 ████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████ 144
2025-W41 ████████████████████████████████████████████████████████████████████████ 70
2025-W42 ████████████████████████████ 28
2025-W43 ████████████████████████████ 28
2025-W44 ████████████████████ 20
2025-W45 ██████████████████████████████████████████████ 46
2025-W46 ██████████████████████████ 26
2025-W47 ██████████████████████████████ 30
2025-W48 ██████████ 10
         ···
         (typical range: 10-40/week, spikes are bulk updates)
```

## API Call Projections

How many calls would the service make to GOV.UK per year?

| ASAP Window | Search API calls/yr | Content API calls/yr | Total/yr | Avg/day |
|-------------|--------------------:|---------------------:|---------:|--------:|
| 15 minutes | 34,953 | 1,785 | 36,738 | 101 |
| 60 minutes | 8,739 | 1,779 | 10,518 | 29 |

### Breakdown

- **Search API calls** scale with polling frequency (96/day at 15min, 24/day at 60min)
- **Content API calls** are fixed (~1,800/yr) — only countries that actually changed get fetched
- **GOV.UK rate limit:** 10 req/sec — both windows are well within limits
- **Peak burst:** worst case 227 content calls in one run = ~23 seconds at rate limit

### Cost of the three schedules firing simultaneously (worst case)

```
ASAP:    1 search + ~5 content   =   6 calls
Daily:   1 search + ~5 content   =   6 calls
Weekly:  1 search + ~30 content  =  31 calls
                                   ─────────
Total:                              43 calls  (< 5 seconds at 10 req/sec)
```

## Key Takeaways

1. **Volume is low.** Even the busiest country (Mexico) changes ~once per week. ASAP notifications will not overwhelm users.

2. **Daily and ASAP are near-identical in volume.** Changes happen less than once/day per country, so both tiers deliver the same count — just with different latency.

3. **Weekly is the real digest.** Most countries bundle 1-3 changes per weekly notification.

4. **API usage is dominated by Search polling.** Content API calls (~1,800/yr) are fixed regardless of ASAP window. The trade-off is Search API frequency.

5. **15-minute ASAP is safe.** ~100 calls/day total, well within the 10 req/sec limit, and delivers changes within 15 minutes of publication.

6. **Peak day (211 changes) is rare** and likely a bulk template update. The rate limiter handles it within a single Lambda invocation.

---

*Data sourced from live GOV.UK Content API on 2026-07-17.*
