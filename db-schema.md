# JobTracker — DynamoDB Schema

## Table overview

Single table, single-table design. Every entity for every user lives in one table called **JobTracker**. Billing is PAY_PER_REQUEST (no provisioned capacity).

**Primary key:**
- `PK` (Hash) — partition key, always a string
- `SK` (Range) — sort key, always a string

**Global secondary indexes:**
- `GSI1` — applications by status + applied date (pipeline view)
- `GSI2` — applications by last activity date (stale detection)

Both GSIs project ALL attributes.

---

## Access patterns

| What you want | How to query |
|---|---|
| All entities for a user | `PK = USER#<sub>` |
| All applications for a user | `PK = USER#<sub>` AND `SK begins_with APP#` |
| All resumes for a user | `PK = USER#<sub>` AND `SK begins_with RESUME#` |
| All email events for a user | `PK = USER#<sub>` AND `SK begins_with EMAIL#` |
| User profile | `PK = USER#<sub>`, `SK = PROFILE` (exact get) |
| Applications filtered by status | GSI1: `GSI1PK = USER#<sub>` AND `GSI1SK begins_with STATUS#<status>#` |
| Applications stale for N days | GSI2: `GSI2PK = USER#<sub>` AND `GSI2SK < LAST_ACTIVITY#<cutoff-date>` |
| OAuth state record (by state token) | `PK = OAUTH_STATE`, `SK = <state-uuid>` (exact get) |

---

## Entities

### User profile

Stores the user's Gmail connection state and encrypted refresh token.

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `USER#<sub>` |
| `SK` | String | `PROFILE` |
| `gmailRefreshToken` | String | AES-encrypted Google OAuth refresh token |
| `gmailConnected` | Boolean | `true` once Gmail is linked |

---

### Application

One record per job application. The most data-rich entity.

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `USER#<sub>` |
| `SK` | String | `APP#<appId>` |
| `appId` | String | UUID, duplicates the SK suffix for convenience |
| `company` | String | Company name |
| `role` | String | Job title |
| `status` | String | Current pipeline status (see statuses below) |
| `appliedAt` | String | ISO 8601 date — when the user applied |
| `createdAt` | String | ISO 8601 timestamp — when the record was created |
| `lastActivityAt` | String | ISO 8601 timestamp — updated on every status change |
| `statusHistory` | List | Ordered log of every status transition (see below) |
| `jobUrl` | String | *(optional)* Link to the job posting |
| `resumeVersionId` | String | *(optional)* FK → `RESUME#<versionId>` |
| `salaryRange` | Map | *(optional)* `{ min, max, currency }` all numbers/string |
| `notes` | String | *(optional)* Free-text notes |
| `autoCreated` | Boolean | *(optional)* `true` if the record was created by the email classifier, not manually |
| `ghostedAt` | String | *(optional)* ISO 8601 timestamp — set when status auto-transitions to `ghosted` |
| `GSI1PK` | String | `USER#<sub>` |
| `GSI1SK` | String | `STATUS#<status>#<appliedAt>` — enables pipeline queries |
| `GSI2PK` | String | `USER#<sub>` |
| `GSI2SK` | String | `LAST_ACTIVITY#<lastActivityAt>` — enables stale queries; **removed** when status becomes `ghosted` |

**Note:** When an application is ghosted, `GSI2PK` and `GSI2SK` are removed so it no longer appears in stale-detection scans.

#### Application statuses

Pipeline (active):
```
applied → screening → phone_interview → technical_interview → onsite → offer → accepted
```

Terminal (no further transitions):
- `rejected` — company said no
- `withdrawn` — user withdrew
- `ghosted` — auto-set after 30 days of no activity on a pipeline application

#### statusHistory item shape

Each entry in the `statusHistory` list is a map:

| Field | Type | Description |
|---|---|---|
| `status` | String | The status value at this point |
| `at` | String | ISO 8601 timestamp |
| `source` | String | What caused the transition (see below) |

**source values:**
- `created` — initial status when the application was first saved
- `manual` — user changed it in the UI
- `email_auto` — classifier applied it automatically (high confidence match)
- `email_confirmed` — user confirmed a classifier suggestion
- `auto_ghosted` — stale-digest Lambda set it after 30 days of inactivity
- `backfill` — used by migration scripts

---

### Resume

One record per uploaded resume file. Tracks S3 location and how many applications reference it.

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `USER#<sub>` |
| `SK` | String | `RESUME#<versionId>` |
| `versionId` | String | UUID, duplicates the SK suffix for convenience |
| `label` | String | Human-readable name (e.g. "Fullstack w/ Ghosted") |
| `s3Key` | String | S3 object key: `<userId>/<versionId>/<filename>` |
| `uploadedAt` | String | ISO 8601 timestamp |
| `useCount` | Number | How many applications reference this resume; incremented/decremented when applications are created, updated, or deleted |

---

### Email event

One record per Gmail message processed by the classifier pipeline. Used for review, deduplication, and linking emails to applications.

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `USER#<sub>` |
| `SK` | String | `EMAIL#<gmailMsgId>` |
| `gmailMsgId` | String | Gmail message ID — used for dedup by the poller |
| `sender` | String | Full `From:` header value |
| `subject` | String | Email subject line |
| `snippet` | String | First ~200 chars of the email body |
| `receivedAt` | String | ISO 8601 timestamp from Gmail |
| `createdAt` | String | ISO 8601 timestamp — when the record was written |
| `classification` | String | LLM classification result (see values below) |
| `confidence` | Number | LLM confidence score, 0–1 |
| `status` | String | Processing state: `classified` or `ignored` |
| `classifiedAt` | String | ISO 8601 timestamp — when classification completed |
| `applicationId` | String \| null | FK → `APP#<appId>` if the classifier matched this email to an application |
| `suggestedStatus` | String \| null | Pipeline status the classifier thinks this email implies |
| `needsReview` | Boolean | `true` if the user should review this email in the UI |
| `reviewed` | Boolean | `true` once the user has confirmed or dismissed |
| `reviewedAt` | String | *(optional)* ISO 8601 timestamp — set when the user reviews |
| `actionSummary` | String \| null | Short to-do description, only set for `follow_up_needed` emails |
| `actionDeadline` | String \| null | `YYYY-MM-DD` deadline, only set for `follow_up_needed` emails |

**Ignored emails** (recruiter_outreach, unrelated, job_alert) are stored as minimal tombstones — only `classification`, `status: "ignored"`, and `classifiedAt` are written. This keeps the poller dedup working without storing irrelevant content.

#### classification values

| Value | Meaning |
|---|---|
| `rejection` | Company rejected the applicant |
| `interview_request` | Company wants to schedule an interview |
| `offer` | Job offer received |
| `application_acknowledged` | Auto-reply confirming the application was received |
| `follow_up_needed` | Applicant must take an action (assessment, references, scheduling) |
| `recruiter_outreach` | Cold outreach from a recruiter (ignored) |
| `job_alert` | Job listing alert (ignored) |
| `unrelated` | Not job-related (ignored) |

#### needsReview logic

`needsReview` is `true` only when ALL of:
- The classifier did NOT auto-apply a status change (auto-apply requires confidence ≥ 0.8 + matched applicationId + suggestedStatus + classification is rejection/interview_request/offer)
- The email was NOT auto-created (i.e. it didn't trigger a new application record)
- Classification is not `unrelated`, `job_alert`, or `recruiter_outreach`

---

### OAuth state

Ephemeral record created during Gmail OAuth flow. Deleted immediately after the callback is processed. Has a TTL.

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `OAUTH_STATE` (literal, not user-scoped) |
| `SK` | String | State UUID passed to Google as the `state` parameter |
| `sub` | String | User's Cognito sub — used to update the right profile on callback |
| `expiresAt` | Number | Unix timestamp (seconds) — TTL attribute |

---

## GSI key patterns

```
GSI1PK = USER#<sub>
GSI1SK = STATUS#<status>#<appliedAt>       e.g. STATUS#applied#2026-06-07T00:00:00.000Z

GSI2PK = USER#<sub>
GSI2SK = LAST_ACTIVITY#<lastActivityAt>    e.g. LAST_ACTIVITY#2026-06-10T20:55:38.094Z
```

Only Application records carry GSI keys. Profile, Resume, Email, and OAuth items do not project into either GSI.

GSI2 keys are **removed** from ghosted applications so the stale-detection sweep never revisits them.
