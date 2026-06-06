# Next Steps

## Where we are

Days 1–14 of the build plan are done except README and blog post. The app is live at `ghosted.macsampson.com`. See `job-tracker-spec.md` for the full build plan and architecture.

**Running locally:**
```bash
docker compose up -d          # DynamoDB Local on :8000
npm run db:setup              # first time only
cp apps/web/.env.local.example apps/web/.env.local  # already done
# apps/api/.env already exists with Gmail credentials
npm run dev                   # API :3001, web :5173
```

**Running tests:**
```bash
docker compose up -d          # DynamoDB Local must be running
npm test --workspaces --if-present   # all 95 tests
npm test --workspace=apps/api        # 81 API integration tests (6 files)
npm test --workspace=apps/web        # 14 web unit tests
```

**What's shipped:**
- Application CRUD with table view, modal form, status badges
- Resume manager — upload, list (label / date / use count), delete, view (opens PDF in new tab), download; `useCount` increments/decrements correctly on create/update/remove
- Pipeline kanban — drag cards across Applied → Screening → Phone → Technical → Onsite → Offer; terminal statuses in a collapsed section at the bottom
- Analytics dashboard — pipeline funnel bars, resume response rate table, avg days-in-stage bars, stale applications list
- Email monitoring — Gmail OAuth flow (AES-256-GCM encrypted refresh token in DDB), email-poller Lambda (EventBridge every 15 min → Gmail API → SQS FIFO), classifier Lambda (heuristic domain pre-filter → multi-LLM: Gemini default / Claude / Ollama → confidence-gated status updates), email review queue UI, auto-create applications from inbound recruiter emails
- Settings page — Gmail connect button, connected state display
- CI pipeline — typecheck + test (DDB Local service container) + build + CDK synth on every push
- `apps/api/.env` with Gmail credentials configured (gitignored)
- SES notifications — `notifier.ts` helper wires into classifier; sends email on high-confidence offer/interview_request auto-applies
- Daily stale-application digest — `stale-digest.ts` Lambda scans all user profiles, queries GSI2 for 14-day-idle pipeline apps, sends SES summary; EventBridge fires at 9am ET
- CloudFront + S3 SPA hosting — `SpaBucket` (OAC, no public access) + `Distribution` with React Router SPA fallback (403/404 → index.html); custom domain via `--context acmCertificateArn=...` at deploy time; outputs `SpaBucketName`, `CloudFrontDomain`, `CloudFrontDistributionId`
- Production deploy at `ghosted.macsampson.com` — Cognito Google IdP, all Lambdas live, FIFO SQS pipeline, CloudFront + S3 frontend; deployment issues documented in `aws-issues.md`
- Secrets sync script (`scripts/sync-secrets.ts`) — pushes `claudeApiKey`, `geminiApiKey`, `encryptionKey`, `gmailClientSecret`, `googleClientSecret` to AWS Secrets Manager (`ghosted/secrets`); run with `npm run secrets:sync`

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

# Deploy CDK stack
cd infra/cdk
cdk deploy \
  --context googleClientId=... \
  --context googleClientSecret=... \
  --context gmailClientId=... \
  --context gmailClientSecret=... \
  --context encryptionKey=... \
  --context geminiApiKey=...

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

**Tests**: integration tests go in `apps/api/src/__tests__/`, use `makeEvent()` / `body()` / `parse()` from `helpers.ts`, `clearTable()` in `beforeEach`. Pure logic goes in `apps/web/src/__tests__/`.

---

## Known loose ends (don't block on these)

- `@aws-lambda-powertools/*` is installed but not yet used — add structured logging when wiring up real Lambda deploys
- SES requires domain verification and production access request before sending to arbitrary addresses
- The CDK stack references `apps/api/dist/handlers` — always `npm run build --workspace=apps/api` before `cdk synth` or `cdk deploy`
