# Known issues

Small, known rough edges. Contributions welcome — see [Contributing](../README.md#contributing).

## Clarify: confirming a validation-derived question reads as a no-op

**Where:** `apps/web/components/sections/clarify-section.tsx` (Clarify step).

**What happens:** The Clarify queue mixes two kinds of question:
1. **Authored** open clarifications (entries in `project.clarifications` with `status: "open"`).
2. **Validation-derived** questions computed from `validation.ts` warnings (e.g. `SOURCE_NEVER_CHECKED`, a source whose `freshness.checkedAt` is unset).

When you answer and **Confirm** a *validation-derived* question, the answer is recorded, but the
question can **immediately reappear** because the underlying condition is still true (e.g. the
source still has no `checkedAt`). Nothing on screen explains this, so it reads as "Confirm did
nothing" — the queue count doesn't visibly drop and "Preserved decisions" doesn't obviously change.

**Observed:** 2026-07-25, driving the workbench for an imported project — confirming the
"Source … has never been checked" question left the queue unchanged.

**Impact:** Confusing, not data-losing. Authored clarifications resolve normally; only the derived
ones feel unresponsive. The Review readiness gate (`claudeBuildChecklist`) counts only authored
open clarifications, so this does not block export.

**Suggested fix:** After confirming a derived question, show a short inline note — e.g. *"Answer
recorded. This question stays open because the underlying warning (source not checked) is still
present; resolve it by setting a `checkedAt` / attaching evidence."* — or route derived questions
to the field that actually clears them, rather than the generic answer box.
