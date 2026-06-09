# Ghosted — Bug Report

A codebase review focused on potential bugs and edge cases. Findings are ordered
by severity, each with a file/line reference and suggested fix.

**Status:** #1, #2, and #3 are fixed (see ✅ notes). #4–#10 are open.

---

## High severity

### 1. `accepted` applications get auto-ghosted after 30 days ✅ Fixed

`apps/api/src/handlers/stale-digest.ts:10` defines terminal statuses as
`['rejected', 'withdrawn', 'ghosted']` — **omitting `accepted`**. The frontend
(`apps/web/src/types/index.ts:35`) correctly treats `accepted` as terminal.

Consequences in the backend:

- `isPipelineStatus('accepted')` returns `true`, so an accepted offer is treated
  as an active pipeline app.
- Every status update writes GSI2 keys, so accepted apps stay in GSI2.
- After 30 days of no activity, `getGhostCandidates` returns it and
  `ghostApplications` overwrites `status` → `ghosted`
  (`stale-digest.ts:101,143`).

Accepting an offer and not touching the record for a month silently rewrites it
to "ghosted," destroying the best outcome. It also surfaces in the 14-day stale
digest email.

**Fix:** add `accepted` to the backend `TERMINAL_STATUSES` set.

**✅ Resolved:** `accepted` added to the backend `TERMINAL_STATUSES` set
(`stale-digest.ts`). Regression test added in `auto-ghost.test.ts` (accepted app
idle 60 days stays `accepted`), and `stale-digest.test.ts` now imports the real
`isPipelineStatus` and asserts `accepted` is terminal.

### 2. Duplicate auto-created applications (concurrency race) ✅ Fixed

The classifier handler processes an SQS batch **concurrently** via
`Promise.allSettled` (`apps/api/src/handlers/classifier.ts:496`). The auto-create
decision in `processRecord` reads the user's existing apps once at the start
(`classifier.ts:344`) and creates a new app if none match.

If two emails from the same previously-untracked company land in one batch (e.g.
an acknowledgment + a rejection from "Acme"), both records run concurrently, both
see no existing Acme app, and **both call `createApplicationFromEmail`** →
duplicate applications. This also defeats the FIFO `MessageGroupId = userId`
ordering guarantee, whose purpose is serialized per-user processing.

**Fix:** process records in series per message group, or add a conditional
put / dedup keyed on normalized company name.

**✅ Resolved:** the handler now groups records by `MessageGroupId` (the user
id), runs groups in parallel but the records within a group strictly in series,
so the second email sees the app the first one created. On a mid-group failure it
fails that record and all later ones in the group, preserving FIFO redelivery
order under `reportBatchItemFailures` (`classifier.ts`).

---

## Medium severity

### 3. `getStaleApplications` doesn't paginate ✅ Fixed

`apps/api/src/handlers/stale-digest.ts:183` issues a single `QueryCommand` with
no `ExclusiveStartKey` loop, unlike its siblings `getGhostCandidates`
(line 84) and `getPendingReviewAppIds` (line 119), which both paginate. A user
with enough stale apps to exceed DynamoDB's 1 MB page limit will silently get a
truncated digest.

**Fix:** wrap the query in the same `do/while (lastKey)` pagination loop.

**✅ Resolved:** the GSI2 query now loops with `ExclusiveStartKey` until
`LastEvaluatedKey` is exhausted, matching its sibling functions (`stale-digest.ts`).

### 4. Encryption silently falls back to an all-zero key

`apps/api/src/lib/crypto.ts:5-7`: if `encryptionKey` is missing from secrets, it
uses `Buffer.alloc(32, 0)` — a hardcoded zero key — with no error or log. In
production this would encrypt Gmail refresh tokens under a guessable key without
anyone noticing.

**Fix:** throw (or loudly warn) when the key is missing and not running locally.

### 5. OAuth `state` never actually expires

`apps/api/src/handlers/auth.ts:72` stores `expiresAt` on the `OAUTH_STATE`
record, but `gmailCallback` (line 104) never checks it, and the table has **no
TTL attribute configured** (no `timeToLive` in `ghosted-stack.ts`). The state is
single-use (deleted at line 113), so impact is limited, but a leaked state value
remains redeemable indefinitely.

**Fix:** enable TTL on `expiresAt`, or check it in the callback.

---

## Low severity

### 6. `useCount` can go negative

`apps/api/src/handlers/resumes.ts:184` does `ADD useCount :dec` with `-1` and no
floor. Any drift between create/update/delete paths leaves a permanently negative
count with no self-correction.

**Fix:** clamp at zero, or guard with a condition expression.

### 7. Frontend `EmailClassification` type is missing `application_acknowledged`

The classifier produces and persists `application_acknowledged`
(`apps/api/src/handlers/classifier.ts:38,45`), but
`apps/web/src/types/index.ts:81` omits it from the union. UI branching on
classification works with an incomplete type.

**Fix:** add `application_acknowledged` to the `EmailClassification` union.

### 8. `extractSenderDomain` mishandles multi-part TLDs

`apps/api/src/handlers/classifier.ts:71-76` returns `parts[length-2]`, so
`recruiting@mail.acme.co.uk` yields `co` instead of `acme`. Only affects the
heuristic pre-filter quality, not correctness of the LLM result.

### 9. `salaryRange.min > max` is never validated

`ApplicationSchema` (`apps/api/src/handlers/applications.ts:8-12`) allows any
nonnegative min/max with no `min <= max` refinement, so a card can render
`$200k–$50k`.

**Fix:** add a Zod `.refine()` enforcing `min <= max`.

### 10. `confirmEmail` doesn't re-validate `suggestedStatus`

`apps/api/src/handlers/emails.ts:56-94` applies whatever `suggestedStatus` is
stored on the email record without re-checking it's a valid status. It's
sanitized at classify time, so this is defense-in-depth only.

---

## Summary

The code is well-structured, and the status-history append logic is handled
consistently across all four transition points.

**#1 (accepted→ghosted)**, **#2 (duplicate auto-create)**, and **#3 (missing
pagination)** have been fixed and covered by tests (121 API tests passing).
The remaining open items (#4–#10) are lower-severity hardening: zero-key
encryption fallback, OAuth state expiry, `useCount` floor, a type-union gap, the
multi-part-TLD heuristic, salary-range validation, and `suggestedStatus`
re-validation.
