# Next Steps

## Where we are

Days 1–9 of the 14-day build plan are done. The monorepo runs fully locally — no AWS account needed for dev. See `job-tracker-spec.md` for the full build plan and architecture.

**Running locally:**
```bash
docker compose up -d          # DynamoDB Local on :8000
npm run db:setup              # first time only
cp apps/web/.env.local.example apps/web/.env.local  # already done
npm run dev                   # API :3001, web :5173
```

**What's shipped:**
- Application CRUD with table view, modal form, status badges
- Resume manager — upload, list (label / date / use count), delete; `useCount` increments/decrements correctly on create/update/remove
- Pipeline kanban — drag cards across Applied → Screening → Phone → Technical → Onsite → Offer; terminal statuses (Rejected, Withdrawn, Ghosted, Accepted) in a collapsed section at the bottom
- Analytics dashboard — pipeline funnel bars, resume response rate table, avg days-in-stage bars, stale applications list; all computed client-side from `useApplications()` + `useResumes()`

---

## Immediate next task: Email Monitoring (Days 10–12)

This is the most architecturally interesting piece — see `job-tracker-spec.md` §5 for the full flow.

### Build order

#### 1. Gmail OAuth flow (backend + frontend)

**Backend** — new handler `apps/api/src/handlers/auth.ts`:
- `GET /auth/gmail` — redirect the user to Google's OAuth consent screen (scopes: `gmail.readonly`)
- `GET /auth/gmail/callback` — exchange code for tokens, encrypt the refresh token (AES-256-GCM, key from SSM), write to DynamoDB `USER#<sub> / PROFILE` under `gmailRefreshToken`
- Register both routes in `apps/api/src/server.ts`

**Frontend** — settings/profile page (new page `apps/web/src/pages/Settings.tsx`):
- Add a "Connect Gmail" button that opens `/auth/gmail` in the same tab
- After redirect-back, show connected state (query `GET /profile` to check if `gmailConnected: true`)
- Wire into `AppLayout.tsx` nav as "Settings"

#### 2. Infrastructure additions (`infra/cdk/lib/stacks/ghosted-stack.ts`)

- **SQS queue** + DLQ (maxReceiveCount: 3)
- **EventBridge Scheduler** — every 15 min, invoke `email-poller` Lambda
- **Two new Lambdas**: `email-poller` and `classifier`
- **IAM**: poller needs DynamoDB read (profiles) + SQS send; classifier needs DynamoDB read/write + SQS receive/delete + SSM read (Claude API key)
- **SSM Parameter** `/ghosted/claude-api-key` (SecureString) — create manually before deploy, reference in CDK

#### 3. `email-poller` Lambda (`apps/api/src/handlers/email-poller.ts`)

Triggered by EventBridge, not API Gateway — signature is `(event: ScheduledEvent) => Promise<void>`:
1. Scan DynamoDB for all `USER#* / PROFILE` items that have `gmailRefreshToken` set
2. For each user, call Gmail API with `q: "newer_than:1h -in:sent"` using the stored refresh token (auto-refresh if expired, persist new access token)
3. For each message not already in DynamoDB (`EMAIL#<msgId>`), push to SQS: `{ userId, gmailMsgId, sender, subject, snippet, receivedAt }`
4. Write a placeholder `EMAIL#<msgId>` record to DynamoDB immediately to prevent reprocessing

#### 4. `classifier` Lambda (`apps/api/src/handlers/classifier.ts`)

Triggered by SQS — signature is `(event: SQSEvent) => Promise<SQSBatchResponse>`:
1. For each SQS record, fetch the user's applications from DynamoDB (for company-matching context)
2. **Heuristic pre-filter**: extract sender domain, check against known company names in the user's applications — skip Claude call if no plausible match, mark as `unrelated`
3. Call Claude API (`claude-sonnet-4-6`) with a structured prompt (see §5 of spec); request JSON output: `{ applicationId, classification, confidence, extractedInfo }`
4. If `confidence >= 0.8` and a matching `applicationId`: update application status in DynamoDB, set `lastActivityAt`
5. Write final `EMAIL#<emailId>` record with all fields including `needsReview: confidence < 0.8`
6. For `offer` or `interview_request` with high confidence: publish to SES (deferred until Days 13–14)
7. Return `{ batchItemFailures: [...] }` for any records that errored (SQS will retry those)

#### 5. Email review queue UI (`apps/web/src/pages/EmailReview.tsx`)

New API endpoint `GET /emails?needsReview=true` — handler in `apps/api/src/handlers/emails.ts`.

Frontend page:
- Table of low-confidence classifications: sender, subject snippet, suggested classification, suggested application match, confidence %
- Two actions per row: **Confirm** (apply the status update) and **Dismiss** (mark reviewed, take no action)
- Add to nav in `AppLayout.tsx`

### Key decisions already made (from spec)
- Polling (not Gmail Pub/Sub push) for v1 — simpler setup, 15-min cadence is fine
- Heuristic pre-filter: match sender domain against known company names before calling Claude (cuts AI cost)
- Claude direct API (not Bedrock) for v1

---

## After email monitoring: Days 13–14 (Polish + Deploy)

- SES notifications for offers and interview requests
- Daily stale-application digest email (new EventBridge daily schedule + Lambda)
- CloudFront distribution for the React SPA
- Production deploy: `cdk deploy` → `ghosted.macsampson.com`
- README with architecture diagram, demo GIF, deployment instructions
- Blog post for SEO + interview talking point

---

## Established patterns to follow

**API handlers** (`apps/api/src/handlers/`):
- Export named async functions typed as `(event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>`
- Use `event.requestContext.authorizer?.claims?.sub` for the user ID
- Validate input with Zod, return early with `badRequest()` on failure
- Wrap everything in try/catch, return `serverError()` on unexpected errors
- Use helpers from `lib/dynamo.ts` (`keys`, `gsi1Keys`, `gsi2Keys`) and `lib/response.ts`

**Registering new routes**: add to `apps/api/src/server.ts` using the `route()` wrapper

**Frontend hooks** (`apps/web/src/hooks/`):
- One file per domain, exports `use<Entity>`, `useCreate<Entity>`, `useUpdate<Entity>`, `useDelete<Entity>`
- Always call `qc.invalidateQueries` on mutation success

**Frontend pages**:
- Import hooks, `cn` from `@/lib/utils`, types from `@/types`
- Tailwind + CSS variables (defined in `src/index.css`) — use `bg-card`, `border-border`, `text-muted-foreground` etc.
- No component library installed — components are hand-rolled with Tailwind (see `AppLayout.tsx`, `Applications.tsx`)

**Types**: shared frontend types live in `apps/web/src/types/index.ts`. Backend types are inlined in handlers (Zod schemas serve as the source of truth).

---

## Known loose ends (don't block on these)

- The `hello-world` Lambda deploy smoke test is deferred until first prod deploy
- `@aws-lambda-powertools/*` is installed but not yet used in any handler — add structured logging when wiring up the real Lambda deploys
- The CDK stack in `infra/cdk/lib/stacks/ghosted-stack.ts` references `apps/api/dist/handlers` — run `npm run build --workspace=apps/api` before any CDK synth/deploy
- Google OAuth credentials still need to be set up in Google Cloud Console before the first `cdk deploy`
