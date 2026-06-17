# Next Steps

## Where we are

Days 1–14 of the build plan are done except README and blog post. The app is live at `ghosted.macsampson.com`. See `job-tracker-spec.md` for the full build plan and architecture.

**Running locally:**
```bash
docker compose up -d          # DynamoDB Local on :8000, MinIO (S3) on :9000 / console :9001
npm run db:setup              # first time only — creates the JobTracker table + ghosted-resumes bucket
cp apps/web/.env.local.example apps/web/.env.local  # already done
# apps/api/.env already exists with Gmail credentials + S3_ENDPOINT/RESUME_BUCKET for MinIO
npm run dev                   # API :3001, web :5173
```

Resume PDFs are stored in MinIO locally so view/download exercise the real presigned-URL
path (no mocks). `apps/api/.env` sets `S3_ENDPOINT=http://localhost:9000` and
`RESUME_BUCKET=ghosted-resumes`. Tests leave `S3_ENDPOINT` unset and stay on a mock path, so
they need no S3/MinIO.

**Running tests:**
```bash
docker compose up -d          # DynamoDB Local must be running
npm test --workspaces --if-present   # all 319 tests
npm test --workspace=apps/api        # 156 API integration tests (8 files)
npm test --workspace=apps/web        # 161 web tests (unit + hooks + component/page)
npm run test:coverage --workspace=apps/web   # full coverage report (all: true)
```

Web coverage: **96% statements / 97% lines** across every source file (`coverage.all` is on,
so untested files count). Pure logic lives in `src/__tests__/lib` and `src/__tests__/hooks`;
component/page render + interaction tests use React Testing Library with the
`renderWithProviders` / domain-factory helpers in `src/__tests__/test-utils.tsx`. Hooks and
pages mock `@/lib/api` (or the `@/hooks/*` modules); Pipeline mocks `@dnd-kit/core` to drive
drag handlers; `App.tsx` uses `vi.hoisted` to stub the Amplify Hub listener.

**What's shipped:**
- `online_assessment` pipeline stage — a distinct stage between `screening` and `phone_interview` so OAs / coding challenges / take-homes are tracked separately from a recruiter screen (`ApplicationStatus`, `STATUS_LABELS`, `PIPELINE_STATUSES`, `ACTIVE_STATUSES`, `SCREENING_PLUS`, the `applications.ts` Zod enum, and the per-status color maps on Applications/Dashboard/Analytics all updated; teal badge/bar). The classifier suggests `online_assessment` for OA-invite emails but keeps them as `follow_up_needed` action items (preserves `actionSummary`/`actionDeadline`, surfaces in the review queue + daily digest) — the suggestion is user-confirmed, never auto-applied
- Public marketing landing page at `/` (`apps/web/src/pages/Landing.tsx` + section components in `apps/web/src/components/landing/`) — bold dark-gradient hero, problem framing, 6-feature grid, AI-email spotlight, how-it-works, privacy/trust section, final CTA, footer. Product-marketing focus aimed at recruiters (technical deep-dive deferred to the blog post; footer has a placeholder link). Authenticated visitors hitting `/` auto-redirect to `/dashboard`. `MediaFrame` is a reusable browser-chrome placeholder for the demo GIFs/videos to be added later (swap in via a `src` prop). Sign-in flows through the additive `startGoogleSignIn(navigate)` helper in `lib/auth.ts` (shared CTA via `components/landing/CtaButton.tsx`). Router restructured: `/` is public Landing, the protected app shell is a pathless parent route. `index.html` got real title + meta/OG/Twitter tags. Open follow-ups: record demo media and point the footer "technical write-up" link at the published blog post
- Application CRUD with table view, modal form, status badges
- Resume manager — upload, list (label / date / use count), delete, view (opens PDF in new tab), download; `useCount` increments/decrements correctly on create/update/remove. View/download go through presigned S3 URLs: `GET /resumes/{versionId}/url` (inline) and `?download=true` (attachment). Locally backed by MinIO; in prod the route is wired in API Gateway (`ghosted-stack.ts`) — it was previously missing there, which surfaced as a CORS error on the preflight
- Pipeline kanban — drag cards across Applied → Screening → Online Assessment → Phone → Technical → Onsite → Offer; terminal statuses in a collapsed section at the bottom
- Analytics dashboard — pipeline funnel bars, resume response rate table, avg days-in-stage bars, stale applications list
- Status-transition history — every application carries an append-only `statusHistory: [{ status, at, source }]` log, written at all four transition points (manual update, email confirm, classifier auto-update, auto-ghost). This is the source of truth for funnel depth and time-to-response (current status alone can't tell how far a rejected app got). Backfilled for pre-existing apps via `scripts/backfill-status-history.ts` (synthesizes applied→current; terminal apps floor at `applied`)
- Resume-variant analytics page (`/analytics`) — funnel drop-off per variant (furthest stage reached, monotonic fill), Wilson 95% confidence intervals with a "need more data" badge under n=10, stage-to-stage conversion (flags the weakest step), time-to-first-response per variant (avg + median), and weekly application velocity with response rate. Hand-rolled SVG/Tailwind visuals (no charting dep); all metrics are pure functions in `apps/web/src/lib/metrics.ts`. Correction-aware: moving a status back to an earlier stage is treated as fixing a mistake, so a reverted advance stops counting in the funnel (`maxStageReached` = last *pipeline* stage on record) and an early "response" that was corrected back below screening no longer counts toward time-to-first-response
- Email monitoring — Gmail OAuth flow (AES-256-GCM encrypted refresh token in DDB), email-poller Lambda (EventBridge every 15 min → Gmail API → SQS FIFO), classifier Lambda (heuristic domain pre-filter → multi-LLM: Gemini default / Claude / Ollama → confidence-gated status updates), email review queue UI, auto-create applications from inbound recruiter emails. Scheduled polls use a 12h Gmail lookback; the manual `runPipelineForUser` path takes an optional `window` (e.g. `3d`, validated by `normalizeWindow`, max 100 msgs) to backfill gaps after a refresh-token outage — `POST /debug/poll-emails?window=3d` locally. Dedup (`isAlreadyProcessed`) keeps re-runs idempotent
- `follow_up_needed` action items — `follow_up_needed` is treated as a to-do (the ball's in the applicant's court), not a status approval. The classifier extracts `actionSummary` + `actionDeadline` (stored on the EMAIL# record) and may suggest `screening` *only* for recruiter initial-contact emails (not assessments/references/forms — those stay status-less). Review queue shows the action text + a deadline badge and offers "Mark done" when there's no status to apply (Confirm only when a status is suggested). Surfaced as an "Action needed" stat + list on the Dashboard and an action section in the daily digest. Auto-apply still excludes `follow_up_needed`, so any suggested `screening` is user-confirmed
- Action-needed routing for recruiter leads + feedback-survey filtering — `recruiter_outreach` (a recruiter pinging about a role the applicant has NOT applied to) is no longer silently ignored and is never auto-created as an `applied` application; it's an action item alongside `follow_up_needed` (carries `actionSummary`/`actionDeadline`, always needs review, surfaces in the Dashboard "Action needed" list + daily digest, "Mark done" in the review queue, never auto-applies). A new `application_feedback` classification catches surveys / "rate your candidate experience" emails — added to `IGNORE_CLASSIFICATIONS` so they're tombstoned (for poller dedup) instead of auto-creating phantom applications. Both changes are driven by the classifier prompt (explicit buckets + "never populate newApplication for recruiter_outreach/application_feedback") plus `ACTION_NEEDED_CLASSIFICATIONS` in `classifier.ts`. `application_feedback` is backend-only (always ignored, never surfaced to the web client)
- Settings page — Gmail connect button, connected state display
- CI pipeline — typecheck + test (DDB Local service container) + build + CDK synth on every push. The CDK synth job also runs a `vitest` assertion test (`infra/cdk/test/ghosted-stack.test.ts`, `Template.fromStack`) that guards the `GET /resumes/{versionId}/url` route + CORS preflight against regressing
- `apps/api/.env` with Gmail credentials configured (gitignored)
- SES notifications — `notifier.ts` helper wires into classifier; sends email on high-confidence offer/interview_request auto-applies
- Daily stale-application digest — `stale-digest.ts` Lambda scans all user profiles, queries GSI2 for 14-day-idle pipeline apps, sends SES summary; EventBridge fires at 9am ET. Also appends an "Action needed" section listing open `follow_up_needed` items and fires the digest when there are stale apps *or* action items
- CloudFront + S3 SPA hosting — `SpaBucket` (OAC, no public access) + `Distribution` with React Router SPA fallback (403/404 → index.html); custom domain via `--context acmCertificateArn=...` at deploy time; outputs `SpaBucketName`, `CloudFrontDomain`, `CloudFrontDistributionId`
- Production deploy at `ghosted.macsampson.com` — Cognito Google IdP, all Lambdas live, FIFO SQS pipeline, CloudFront + S3 frontend; deployment issues documented in `aws-issues.md`
- Secrets sync script (`scripts/sync-secrets.ts`) — pushes `claudeApiKey`, `geminiApiKey`, `encryptionKey`, `gmailClientSecret`, `googleClientSecret` to AWS Secrets Manager (`ghosted/secrets`); run with `npm run secrets:sync`
- Mobile-responsive UI — sidebar collapses to a hamburger + slide-out drawer below `lg` (`AppLayout.tsx`); dense tables (Applications, Email review, Dashboard resume/stale lists, Resumes) render as stacked cards on mobile and full tables at `lg`+; forms stack to single column on phones; responsive page padding (`p-4 sm:p-6 lg:p-8`) and headings (`text-xl sm:text-2xl`) across all pages; Pipeline keeps horizontal-scroll kanban with tightened mobile column widths

---

## Production deploy

**Live at [ghosted.macsampson.com](https://ghosted.macsampson.com)**

Initial deployment issues and fixes are documented in `aws-issues.md`.

**To redeploy after changes:**
```bash
npm run build --workspace=apps/api
npm run build --workspace=apps/web

# Sync secrets to Secrets Manager (if changed)
npm run secrets:sync

# Deploy CDK stack — no flags needed.
# googleClientId (a public OAuth client ID) lives in the `context` block of cdk.json.
# Runtime secrets come from Secrets Manager via `npm run secrets:sync`, NOT context.
cd infra/cdk
cdk deploy

# NOTE: googleClientId must stay set in cdk.json (or the GOOGLE_CLIENT_ID env var).
# Deploying without it removes the Cognito Google identity provider and breaks "Sign in
# with Google" in prod. For a custom domain, pass acmCertificateArn (cdk.json context
# or `--context acmCertificateArn=...`).

# Sync frontend dist to S3 and invalidate CloudFront
aws s3 sync apps/web/dist s3://<spa-bucket-name>
aws cloudfront create-invalidation --distribution-id <dist-id> --paths "/*"
```

---

## Remaining tasks (Days 13–14 final items)

### README + blog post

`README.md` at repo root:
- Architecture diagram (GitHub renders the mermaid block from spec natively)
- Demo GIF — record with Kap: create application → move through pipeline → dashboard updating → email review queue
- One-command local setup
- Deploy instructions (condensed checklist above)

Blog post draft title: *"Building a serverless job tracker with AWS CDK, DynamoDB single-table design, and Claude"* — focus on the email pipeline architecture since that's the most interview-interesting piece. Publish on macsampson.com and link from the README.

---

## Established patterns to follow

**API handlers** (`apps/api/src/handlers/`):
- Export named async functions typed as `(event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>`
- Use `event.requestContext.authorizer?.claims?.sub` for the user ID
- Validate input with Zod, return early with `badRequest()` on failure
- Wrap everything in try/catch, return `serverError()` on unexpected errors
- Use helpers from `lib/dynamo.ts` (`keys`, `gsi1Keys`, `gsi2Keys`) and `lib/response.ts`
- Add a `handler` dispatcher export for CDK Lambda entry point

**Registering new routes**: add to `apps/api/src/server.ts` using the `route()` wrapper

**Frontend hooks** (`apps/web/src/hooks/`):
- One file per domain, exports `use<Entity>`, `useCreate<Entity>`, `useUpdate<Entity>`, `useDelete<Entity>`
- Always call `qc.invalidateQueries` on mutation success

**Frontend pages**:
- Import hooks, `cn` from `@/lib/utils`, types from `@/types`
- Tailwind + CSS variables (defined in `src/index.css`) — use `bg-card`, `border-border`, `text-muted-foreground` etc.
- No component library installed — components are hand-rolled with Tailwind

**Types**: shared frontend types live in `apps/web/src/types/index.ts`. Backend types are inlined in handlers (Zod schemas serve as the source of truth).

**Tests**: integration tests go in `apps/api/src/__tests__/`, use `makeEvent()` / `body()` / `parse()` from `helpers.ts`, `clearTable()` in `beforeEach`. Web tests go in `apps/web/src/__tests__/` (mirrors the `lib`/`hooks`/`components`/`pages` layout); render/interaction tests use `renderWithProviders` + factories from `test-utils.tsx`.

---

## Known loose ends (don't block on these)

- `@aws-lambda-powertools/*` is installed but not yet used — add structured logging when wiring up real Lambda deploys
- SES requires domain verification and production access request before sending to arbitrary addresses
- The CDK stack references `apps/api/dist/handlers` — always `npm run build --workspace=apps/api` before `cdk synth` or `cdk deploy`
