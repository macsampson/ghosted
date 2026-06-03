# Next Steps

## Where we are

Days 1–7 of the 14-day build plan are done. The monorepo runs fully locally — no AWS account needed for dev. See `job-tracker-spec.md` for the full build plan and architecture.

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

---

## Immediate next task: Analytics Dashboard

`apps/web/src/pages/Dashboard.tsx` is currently a placeholder that calls `/hello`. Replace it with real metrics computed client-side from `useApplications()` — no new API endpoints needed.

**Metrics to build:**

1. **Funnel** — count per status bucket (pipeline statuses as a bar or step chart; terminal breakdown below)
2. **Response rate per resume** — for each resume version, `applications using it` vs `applications that reached screening+`. Use `useResumes()` + `useApplications()` together.
3. **Time-in-stage** — `lastActivityAt - appliedAt` in days, averaged across all apps per status bucket (shows where things stall)
4. **Stale count** — applications with `lastActivityAt` older than 14 days and still in a pipeline status

All computable client-side. No charting library installed — use CSS bar charts (width as percentage) or simple stat cards rather than pulling in recharts/chart.js unless the result looks too bare.

Reference `apps/web/src/pages/Applications.tsx` for patterns (hooks, layout, Tailwind tokens).

---

## After dashboard: Days 10–12 (Email Monitoring)

This is the most architecturally interesting piece — see `job-tracker-spec.md` §5 for the full flow.

### What needs building

**Backend (infra + Lambdas):**
- Gmail OAuth flow: a `/auth/gmail` route that kicks off OAuth, stores the refresh token encrypted in DynamoDB under `USER#<sub> / PROFILE`
- `email-poller` Lambda: triggered by EventBridge every 15 min, hits Gmail API with `newer_than:1h -in:sent`, pushes raw message metadata to SQS
- `classifier` Lambda: consumes SQS, sends to Claude API for classification (rejection / interview_request / offer / recruiter_outreach / unrelated), confidence-gates auto-status updates (threshold 0.8), writes `EMAIL#<emailId>` records to DynamoDB
- CDK additions: EventBridge schedule, SQS queue + DLQ, two new Lambdas, IAM roles, SSM param for Claude API key

**Frontend:**
- Gmail connect button in settings/profile (triggers the OAuth flow)
- Email review queue UI: table of low-confidence classifications the user needs to confirm or dismiss — query `GET /emails?needsReview=true`

### Key decisions already made (from spec)
- Polling (not Gmail Pub/Sub push) for v1 — simpler setup, 15-min cadence is fine
- Heuristic pre-filter: match sender domain against known company names before calling Claude (cuts AI cost)
- Claude direct API (not Bedrock) for v1

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
