# Next Steps

## Where we are

Days 1–12 of the 14-day build plan are done. The monorepo runs fully locally — no AWS account needed for dev. See `job-tracker-spec.md` for the full build plan and architecture.

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
npm test --workspaces --if-present   # all 61 tests
npm test --workspace=apps/api        # 47 API integration tests
npm test --workspace=apps/web        # 14 web unit tests
```

**What's shipped:**
- Application CRUD with table view, modal form, status badges
- Resume manager — upload, list (label / date / use count), delete; `useCount` increments/decrements correctly on create/update/remove
- Pipeline kanban — drag cards across Applied → Screening → Phone → Technical → Onsite → Offer; terminal statuses in a collapsed section at the bottom
- Analytics dashboard — pipeline funnel bars, resume response rate table, avg days-in-stage bars, stale applications list
- Email monitoring — Gmail OAuth flow (AES-256-GCM encrypted refresh token in DDB), email-poller Lambda (EventBridge every 15 min → Gmail API → SQS FIFO), classifier Lambda (heuristic domain pre-filter → Claude API → confidence-gated status updates), email review queue UI
- Settings page — Gmail connect button, connected state display
- CI pipeline — typecheck + test (DDB Local service container) + build + CDK synth on every push
- `apps/api/.env` with Gmail credentials configured (gitignored)
- SES notifications — `notifier.ts` helper wires into classifier; sends email on high-confidence offer/interview_request auto-applies
- Daily stale-application digest — `stale-digest.ts` Lambda scans all user profiles, queries GSI2 for 14-day-idle pipeline apps, sends SES summary; EventBridge fires at 9am ET

---

## Before deploying: verify Gmail OAuth locally

Gmail credentials are now in `apps/api/.env`. Test the real OAuth flow locally before deploying so you know it works end-to-end:

1. In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → the OAuth client:
   - Add `http://localhost:3001/auth/gmail/callback` to **Authorized redirect URIs** (if not already there)
2. Restart the API server: `npm run dev --workspace=apps/api`
3. Go to **http://localhost:5173/settings** and click **Connect Gmail**
   - This calls `POST /auth/gmail/start` which, with real credentials set, returns `{ authUrl }` and redirects your browser to Google's consent screen
   - After granting access, Google redirects to `http://localhost:3001/auth/gmail/callback`, which stores the encrypted refresh token in DynamoDB Local and redirects you to `/settings?connected=true`
4. Confirm the Settings page shows "Gmail connected"

If it still shows as a mock connect (returns immediately without leaving the page), the server hasn't picked up the credentials — restart it.

---

## Immediate next task: Polish + Deploy (Days 13–14)

### 1. SES notifications

New file `apps/api/src/handlers/notifier.ts` — a shared helper called from the classifier (not a separate Lambda):

```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const FROM = process.env.SES_FROM_EMAIL;

export async function sendClassificationNotification(
  toEmail: string,
  classification: 'offer' | 'interview_request',
  company: string,
  role: string,
): Promise<void> {
  if (!FROM) return; // skip in local dev
  const subject = classification === 'offer'
    ? `Offer received from ${company}`
    : `Interview request from ${company}`;
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Text: { Data: `${role} at ${company}\n\nhttps://ghosted.macsampson.com` } },
    },
  }));
}
```

Wire into `classifier.ts`: after auto-applying a status update, call `sendClassificationNotification(userEmail, classification, company, role)`. The user's email comes from the profile record — fetch it in `processRecord()` alongside `getUserApplications()`.

CDK: add `SES_FROM_EMAIL: 'noreply@macsampson.com'` to classifier Lambda env; grant `ses:SendEmail` to the classifier IAM role.

**Before deploying**: verify `macsampson.com` domain in SES (AWS Console → SES → Verified identities). SES sandbox mode only allows sending to verified addresses until you request production access.

### 2. Daily stale-application digest

New Lambda `apps/api/src/handlers/stale-digest.ts` — EventBridge daily schedule (9am ET):
1. Scan DDB for all `USER#* / PROFILE` items to get user emails
2. For each user, query GSI2 for applications with `LAST_ACTIVITY#` older than 14 days and status in pipeline statuses
3. If any found, send one SES email listing them: company, role, status, days idle

CDK additions to `ghosted-stack.ts`:
```typescript
const staleDigestFn = new lambda.Function(this, 'StaleDigestFn', {
  ...lambdaDefaults,
  functionName: 'ghosted-stale-digest',
  code: lambda.Code.fromAsset(apiHandlerPath),
  handler: 'stale-digest.handler',
  environment: { ...sharedEnv, SES_FROM_EMAIL: 'noreply@macsampson.com' },
});
table.grantReadData(staleDigestFn);
staleDigestFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ses:SendEmail'],
  resources: ['*'],
}));
const dailyRule = new events.Rule(this, 'DailyDigestSchedule', {
  schedule: events.Schedule.cron({ hour: '14', minute: '0' }), // 9am ET
});
dailyRule.addTarget(new targets.LambdaFunction(staleDigestFn));
```

### 3. CloudFront + S3 frontend hosting

Add to `ghosted-stack.ts`:
```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
```

- S3 bucket for the built React SPA (OAC, no public access)
- CloudFront distribution: S3 origin for `/*`, API Gateway origin for `/api/*`
- Custom domain `ghosted.macsampson.com` with ACM certificate (must be in `us-east-1`)
- After deploy: `aws s3 sync apps/web/dist s3://<spa-bucket>` or use `BucketDeployment` construct

### 4. Production deploy checklist

```bash
# One-time pre-deploy steps (AWS console / CLI):
# 1. Verify macsampson.com in SES → Verified identities
# 2. Request ACM certificate for ghosted.macsampson.com in us-east-1
# 3. Add https://ghosted.macsampson.com/auth/gmail/callback to Google OAuth redirect URIs
# 4. Generate encryption key: openssl rand -hex 32

# Build
npm run build --workspace=apps/api
npm run build --workspace=apps/web

# Deploy (pass secrets as context or env vars — never commit them)
cd infra/cdk
cdk deploy \
  --context googleClientId=... \
  --context googleClientSecret=... \
  --context gmailClientId=... \
  --context gmailClientSecret=... \
  --context encryptionKey=... \
  --context claudeApiKey=...

# Post-deploy
# - Sync web dist to S3
# - Add ghosted.macsampson.com CNAME → CloudFront distribution domain
# - Smoke test: sign in, create an application, connect Gmail
```

### 5. README + blog post

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
