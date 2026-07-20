# Ghosted

Personal job application tracker. Tracks applications and resume variants, monitors Gmail with AI-powered email classification to auto-update statuses.

Live at **ghosted.macsampson.com**

---

## Architecture

```mermaid
flowchart TB
    User([Browser]) --> CF[CloudFront + S3\nReact SPA]
    CF --> Cognito[Cognito\nGoogle Sign-In]
    CF --> APIGW[API Gateway]
    APIGW --> AuthZ{Cognito Authorizer}
    AuthZ --> AppLambda[Applications Lambda]
    AuthZ --> ResumeLambda[Resumes Lambda]
    AuthZ --> EmailLambda[Emails Lambda]
    AuthZ --> AuthLambda[Auth Lambda]
    AppLambda --> DDB[(DynamoDB\nSingle Table)]
    ResumeLambda --> S3R[S3 Resume PDFs]
    ResumeLambda --> DDB
    EmailLambda --> DDB
    AuthLambda --> DDB

    EB[EventBridge\nevery 15 min] --> PollerLambda[Email Poller Lambda]
    PollerLambda --> Gmail[Gmail API]
    PollerLambda --> SQS[SQS FIFO Queue]
    SQS --> ClassifyLambda[Classifier Lambda]
    ClassifyLambda --> LLM[Gemini / Claude / Ollama]
    ClassifyLambda --> DDB
    ClassifyLambda --> SES[SES Notifications]

    EBD[EventBridge\ndaily 9am ET] --> StaleLambda[Stale Digest Lambda]
    StaleLambda --> DDB
    StaleLambda --> SES
```

The email pipeline is the interesting piece: EventBridge triggers a poller every 15 minutes, which fetches recent Gmail messages and pushes them onto a SQS FIFO queue. The classifier Lambda consumes the queue, runs a heuristic domain pre-filter to skip unrelated mail before hitting the LLM, then confidence-gates any automatic status updates (≥0.8 required). Low-confidence matches land in the review queue UI for manual confirmation.

---

## Local dev

**Prerequisites:** Docker, Node 20

```bash
# 1. Start DynamoDB Local + MinIO (S3-compatible store for resume PDFs)
docker compose up -d

# 2. Create the table and resume bucket (first time only)
npm run db:setup

# 3. Copy and fill in the env file
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — see comments in that file for what each var does

# 4. Start API (:3001) and web (:5173)
npm run dev
```

Auth bypass is on by default — no Cognito or Google sign-in needed locally. The API injects a fake user matching what Cognito would provide in production.

**Resume storage locally:** PDFs go to MinIO (console at http://localhost:9001, `minioadmin`/`minioadmin`). `apps/api/.env` sets `S3_ENDPOINT` and `RESUME_BUCKET`, so view/download exercise the same presigned-URL flow as production.

**Gmail OAuth locally:** Without `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` set, clicking "Connect Gmail" uses a mock token. To test the real OAuth flow, fill in those vars, add `http://localhost:3001/auth/gmail/callback` to the Google Cloud Console OAuth client's authorized redirect URIs, and restart the server.

**Classifier locally:** Set `GEMINI_API_KEY` for Gemini (default), `CLAUDE_API_KEY` for Claude, or run Ollama and set `OLLAMA_MODEL` + `OLLAMA_BASE_URL` for a fully local option.

### Seeding mock data

`scripts/seed-dev.py` fills the local table with 100 realistic mock applications (useful for screenshots and UI work). It talks to DynamoDB Local at `localhost:8000`, so make sure `docker compose up -d` and `npm run db:setup` have run first.

The script needs `boto3`. The system Python is externally-managed (PEP 668), so install it into a project virtualenv rather than globally:

```bash
# One-time setup
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt

# Run the seed (wipes existing APP# items for the dev user first)
.venv/bin/python scripts/seed-dev.py
```

The same venv covers the other Python utilities in `scripts/`.

### Useful dev commands

```bash
npm run db:reset          # wipe and recreate local table
npm run typecheck         # type-check all workspaces
npm run lint              # lint all workspaces
```

---

## Tests

DynamoDB Local must be running (MinIO is not needed — resume handler tests use a mock path).

```bash
npm test --workspace=apps/api        # 121 API integration tests
npm test --workspace=apps/web        # 49 web unit tests
npm test --workspace=infra/cdk       # CDK assertion tests (synthesizes the stack)

# All workspaces at once — build the API first so the CDK synth test has its Lambda
# assets (otherwise that suite skips itself):
npm run build --workspace=apps/api && npm test --workspaces --if-present
```

---

## Deploying to production

### One-time setup

- SES: verify your sending domain in SES → Verified identities
- ACM: request a cert for your custom domain in `us-east-1`
- Google Cloud Console: add `https://<your-domain>/auth/gmail/callback` to the Gmail OAuth client's authorized redirect URIs

### Deploy

**Use the GitHub Actions deploy workflow.** It injects the correct `VITE_*` env vars at build time. Never run `npm run build` locally and sync the output — `.env.local` gets baked into the bundle and breaks production auth.

To trigger manually: Actions → Deploy → Run workflow.

If you need to deploy from a local machine (e.g. infrastructure-only change), build the frontend with all env vars explicitly set:

```bash
# Build API
npm run build --workspace=apps/api

# Build frontend with production env vars (never run bare npm run build here).
# Fill these in with the outputs from your own CDK deploy.
VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod \
VITE_USER_POOL_ID=<region>_XXXXXXXXX \
VITE_USER_POOL_CLIENT_ID=<user-pool-client-id> \
VITE_COGNITO_DOMAIN=<your-cognito-domain>.auth.<region>.amazoncognito.com \
VITE_AUTH_BYPASS=false \
npm run build --workspace=apps/web

# Push secrets to Secrets Manager (only needed if secrets changed)
npm run secrets:sync

# Deploy CDK stack — no context flags needed.
# googleClientId (a public OAuth client ID) lives in cdk.json's `context` block; runtime
# secrets come from Secrets Manager (above). Add the cert ARN only for the custom domain.
cd infra/cdk
cdk deploy   # custom domain: append --context acmCertificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID

# Sync frontend to S3 and bust the cache (use your CloudFrontDomain / bucket outputs)
cd ../..
aws s3 sync apps/web/dist s3://<your-spa-bucket> --delete
aws cloudfront create-invalidation --distribution-id <your-distribution-id> --paths "/*"
```

### What `secrets:sync` does

Reads `apps/api/.env` and pushes these keys to `ghosted/secrets` in Secrets Manager:
`geminiApiKey`, `claudeApiKey`, `encryptionKey`, `gmailClientSecret`, `googleClientSecret`

Verify with:
```bash
aws secretsmanager get-secret-value --secret-id ghosted/secrets | jq '.SecretString | fromjson'
```

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, TanStack Query, Tailwind |
| Backend | Node 22 Lambdas, TypeScript, Zod, AWS SDK v3 |
| Database | DynamoDB single-table (`JobTracker`) |
| Auth | Cognito User Pool + Google IdP |
| Email pipeline | EventBridge → Lambda → Gmail API → SQS FIFO → Lambda → Gemini |
| Notifications | SES |
| Hosting | CloudFront + S3 |
| IaC | AWS CDK v2 |
| CI | GitHub Actions (typecheck → test → build → cdk synth + assertion tests) |

---

## Notes

- `apps/api/.env` is the single source of truth for local secrets and is gitignored — copy `apps/api/.env.example` to get started.
- The frontend deploy workflow (`.github/workflows/deploy.yml`) reads its prod config from GitHub Actions repository variables (`VITE_API_URL`, `VITE_USER_POOL_ID`, `AWS_DEPLOY_ROLE_ARN`, `SPA_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, etc.) — set these under Settings → Secrets and variables → Actions before running it.
