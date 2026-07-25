---
owner: "dana@lumenfit.example"
sources: ["LumenFit domain brief (fictional, 2026-07)", "verified_queries pack T1/A1/C1", "domain clarification session 2026-07-16"]
last_verified: 2026-07-18
confidence: medium
---

# Subscription Usage — Overview (fictional example)

## What it is

LumenFit is a consumer fitness-subscription app. This domain covers **who is subscribed, whether
trials convert, how much members use the app, and who is at risk of leaving.** Questions here are
mostly **product and lifecycle** questions.

Two sides:

- **Subscription** — trial → paid conversion, active subscriber counts, churn.
- **Engagement** — how many minutes members actually spend working out (`active_minutes`).

The two are linked but not the same: an engaged member isn't always a paying one, and a paying
member isn't always engaged (see caveat C-04).

## The decisions it supports

- **Which plans to promote** — annual converts better but engages less in month one; monthly is the
  reverse. Check T1 (conversion by plan) before a pricing push.
- **Where trials leak** — if conversion drops, is it a plan, a cohort, or a seasonal effect?
- **Who to save** — C1 flags at-risk cycles so Lifecycle can intervene before cancellation.

## How it's measured

| Metric | Definition (short) | Grain | Owner |
| --- | --- | --- | --- |
| `trial_conversion_rate` | paid conversions / trials started, by trial-start cohort | Per cohort month | dana@lumenfit.example |
| `active_subscribers` | count of `SUBSCRIPTION_STATE = 'active'`, point in time | Per member, snapshot | dana@lumenfit.example |
| `active_minutes` | sum of session minutes (≥60s), per member | Per member, per period | priya@lumenfit.example |
| `monthly_churn_rate` | cancels in month / actives at month start | Per month | dana@lumenfit.example |

All four are `status: draft` pending sign-off in `../data_context/metrics.yml`.

## The boundary

| Sounds like ours | Goes to | Why |
| --- | --- | --- |
| *"MRR from annual plans"* | Finance | They own revenue metrics |
| *"Cost per trial from ads"* | Growth | They own acquisition + spend |
| *"Which workout classes retain best"* | Content | They own content performance |
| *"Did engagement drive revenue?"* | This domain (engagement) + Finance (revenue) | Surface `active_minutes`; hand off the revenue link |
