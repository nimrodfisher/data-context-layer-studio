# Caveats — known gotchas for Subscription Usage (fictional example)

**Read this before any query.** These are the things that will silently give you a wrong number.

## How to treat a caveat

| Severity | What you do |
| --- | --- |
| **`BLOCKER`** | **Stop and ask. Produce no number.** |
| **`CORRECTION`** | **Apply it automatically — and say you did.** |
| **`NOTE`** | Mention **only if** it materially affects how the number should be read. |

---

## The caveats

### C-01 — Internal/staff accounts skew everything
- **Severity:** `CORRECTION`
- **Where:** every table (`DIM_MEMBER`, `FACT_MEMBER_SESSION`, `FACT_SUBSCRIPTION_CYCLE`)
- **What:** ~1,900 staff and QA accounts have unlimited plans and abnormal usage.
- **What to do:** always filter `IS_INTERNAL = FALSE`. Applied automatically; say so.
- **Found:** 2026-07-17

### C-02 — Trials are not subscribers
- **Severity:** `CORRECTION`
- **Where:** `FACT_SUBSCRIPTION_CYCLE.SUBSCRIPTION_STATE`
- **What:** `'trialing'` rows look like subscriptions but no payment has occurred.
- **What to do:** exclude `'trialing'` from subscriber counts unless the question is about trials.
- **Found:** 2026-07-17

### C-03 — A pause is not a churn
- **Severity:** `CORRECTION`
- **Where:** `SUBSCRIPTION_STATE = 'paused'`
- **What:** paused members stop paying but haven't cancelled; counting pauses as churn overstates it.
- **What to do:** churn counts only `'cancelled'`. Report pauses separately if asked.
- **Found:** 2026-07-17

### C-04 — "Active" means two different things
- **Severity:** `BLOCKER`
- **Where:** `active_subscribers` vs `active_minutes`
- **What:** "active" can mean *paying* (subscriber) or *engaged* (using the app). They diverge a lot.
- **What to do:** **stop and ask which one** before answering any "how many active…" question.
- **Found:** 2026-07-17

### C-05 — Sub-minute sessions are accidental opens
- **Severity:** `CORRECTION`
- **Where:** `FACT_MEMBER_SESSION.SESSION_DURATION_SECONDS`
- **What:** ~8% of sessions are under 60s — app opened and closed, not real usage.
- **What to do:** exclude `SESSION_DURATION_SECONDS < 60` from engagement metrics.
- **Found:** 2026-07-17

### C-06 — Plan tier is a code, not a name
- **Severity:** `NOTE`
- **Where:** `DIM_MEMBER.PLAN_TIER`
- **What:** `PLAN_TIER` is an integer (`1` = monthly, `2` = annual, `3` = family), not a label.
- **What to do:** map the code; never filter on a plan *name* string — there isn't one.
- **Found:** 2026-07-17
