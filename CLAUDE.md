# Ghosted — Claude Code Instructions

## Session start

Read these two files at the start of every session before doing any work:

- `job-tracker-spec.md` — architecture, data model, tech stack, full build plan
- `next-steps.md` — current progress, what's done, what's next, established patterns

## Project overview

**Ghosted** is a personal job application tracker deployed at `ghosted.macsampson.com`. It tracks applications, resume variants, and auto-updates statuses by monitoring Gmail with Claude-powered email classification.

**Monorepo layout:**
```
apps/web/        React 18 + TypeScript SPA (Vite, TanStack Query, Tailwind)
apps/api/        Node.js 20 Lambda handlers (TypeScript, Zod, AWS SDK v3)
infra/cdk/       AWS CDK v2 stack (TypeScript)
scripts/         DB setup and utilities
```

**Key services:** Cognito (Google IdP) → API Gateway → Lambda → DynamoDB (single-table). Email pipeline: EventBridge → email-poller Lambda → SQS → classifier Lambda → Claude API.

## Local dev

```bash
docker compose up -d          # DynamoDB Local on :8000
npm run db:setup              # first time only
npm run dev                   # API :3001, web :5173
```

Auth bypass is on by default locally — no Cognito needed. `apps/api/.env` holds secrets (gitignored).

**Tests:**
```bash
docker compose up -d
npm test --workspaces --if-present   # all 61 tests
```

## Feature creation workflow

**Only work on one feature at a time.** Complete the full workflow (build, test, update docs) for one feature before starting the next.

### 1. Plan
- Check `next-steps.md` for context on what's next and why
- Identify which layers are touched: handler, route, hook, page, CDK

### 2. Build

**API handler** (`apps/api/src/handlers/<entity>.ts`):
- Export named async functions typed as `(event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>`
- Get user ID from `event.requestContext.authorizer?.claims?.sub`
- Validate input with Zod, return early with `badRequest()` on failure
- Wrap in try/catch, return `serverError()` on unexpected errors
- Use `lib/dynamo.ts` (`keys`, `gsi1Keys`, `gsi2Keys`) and `lib/response.ts`
- Export a `handler` dispatcher for the CDK Lambda entry point

**Register route** in `apps/api/src/server.ts` using the `route()` wrapper.

**Frontend hook** (`apps/web/src/hooks/use<Entity>.ts`):
- One file per domain: `use<Entity>`, `useCreate<Entity>`, `useUpdate<Entity>`, `useDelete<Entity>`
- Always call `qc.invalidateQueries` on mutation success

**Frontend page** (`apps/web/src/pages/<Page>.tsx`):
- Import hooks, `cn` from `@/lib/utils`, types from `@/types`
- Use Tailwind + CSS variables: `bg-card`, `border-border`, `text-muted-foreground`, etc.
- Components are hand-rolled with Tailwind — no component library

**Shared types** live in `apps/web/src/types/index.ts`. Backend types use Zod schemas as source of truth.

**CDK** (`infra/cdk/lib/ghosted-stack.ts`):
- Add new Lambdas using `lambdaDefaults` pattern
- Grant only the permissions the Lambda needs
- Always `npm run build --workspace=apps/api` before `cdk synth` or `cdk deploy`

### 3. Test

**Write tests before implementing the feature.** Define the expected behavior in tests first, then make them pass. Do not skip this step.

**Never modify existing tests without explicit approval from the user.** If a change would break an existing test, stop and discuss rather than updating the test to pass.

**API integration tests** (`apps/api/src/__tests__/`):
- Use `makeEvent()` / `body()` / `parse()` from `helpers.ts`
- Call `clearTable()` in `beforeEach`
- Run against DynamoDB Local (must be up)

**Frontend unit tests** (`apps/web/src/__tests__/`):
- Pure logic only, no dependencies on DDB or network

### 4. Update docs

After implementing a feature, update both files:

**`next-steps.md`:**
- Mark completed checklist items with `[x]`
- Update the "What's shipped" section
- Remove or revise guidance that's now stale

**`job-tracker-spec.md`:**
- Mark the corresponding build plan item `[x]`
- Update architecture or data model notes if the implementation diverged

## Data model quick reference

Table: `JobTracker` (single-table design)

| PK | SK | Entity |
|---|---|---|
| `USER#<sub>` | `PROFILE` | User profile + gmailRefreshToken |
| `USER#<sub>` | `APP#<appId>` | Application |
| `USER#<sub>` | `RESUME#<versionId>` | Resume version |
| `USER#<sub>` | `EMAIL#<emailId>` | Email event |

GSI1: applications by status + date (pipeline view)
GSI2: applications by last activity (stale detection)

## Application statuses

Pipeline: `applied` → `screening` → `phone_interview` → `technical_interview` → `onsite` → `offer` → `accepted`

Terminal: `rejected`, `withdrawn`, `ghosted` (auto-set after 30 days no activity)

## What's done / what's next

See `next-steps.md` for current state. At time of writing, Days 1–12 are complete. Remaining: SES notifications, stale digest Lambda, CloudFront hosting, production deploy, README.
