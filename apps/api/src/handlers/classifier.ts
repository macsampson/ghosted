import type { SQSEvent, SQSRecord, SQSBatchResponse } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys, appendStatusHistory } from '../lib/dynamo';
import { getSecrets } from '../lib/secrets';
import { sendClassificationNotification } from './notifier';
import { log, logError } from '../lib/logger';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e2b';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

// Pre-load clients at cold start.
const clientsPromise = getSecrets().then(s => ({
  gemini: s.geminiApiKey ? new GoogleGenerativeAI(s.geminiApiKey) : null,
  anthropic: s.claudeApiKey ? new Anthropic({ apiKey: s.claudeApiKey }) : null,
}));

interface EmailSqsMessage {
  userId: string;
  gmailMsgId: string;
  sender: string;
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
}

interface NewApplicationData {
  company: string;
  role: string | null;
  jobUrl: string | null;
  notes: string | null;
}

interface ClassificationResult {
  classification: 'rejection' | 'interview_request' | 'offer' | 'recruiter_outreach' | 'job_alert' | 'follow_up_needed' | 'application_acknowledged' | 'application_feedback' | 'unrelated';
  confidence: number;
  applicationId: string | null;
  suggestedStatus: string | null;
  newApplication: NewApplicationData | null;
  // Populated only for follow_up_needed: a short to-do and an optional deadline.
  actionSummary: string | null;
  actionDeadline: string | null;
}

const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Classifications that represent an action the applicant owes rather than a
// pipeline stage change. follow_up_needed is a to-do on a submitted application
// (assessment, references, scheduling); recruiter_outreach is a lead about a role
// the applicant has NOT applied to — something to respond to, not an application to
// auto-create. Both carry actionSummary/actionDeadline, always go to review, and
// surface in the "Action needed" lists.
const ACTION_NEEDED_CLASSIFICATIONS = new Set(['follow_up_needed', 'recruiter_outreach']);

// Pull the LLM's to-do and deadline for action-needed classifications; force both
// null for every other classification so the fields never carry stale data.
export function cleanActionFields(
  classification: string,
  actionSummary: unknown,
  actionDeadline: unknown,
): { actionSummary: string | null; actionDeadline: string | null } {
  if (!ACTION_NEEDED_CLASSIFICATIONS.has(classification)) {
    return { actionSummary: null, actionDeadline: null };
  }
  const summary = typeof actionSummary === 'string' && actionSummary.trim() ? actionSummary.trim() : null;
  const deadline = typeof actionDeadline === 'string' && DEADLINE_RE.test(actionDeadline) ? actionDeadline : null;
  return { actionSummary: summary, actionDeadline: deadline };
}

const AUTO_CREATE_CLASSIFICATIONS = new Set(['rejection', 'interview_request', 'offer', 'follow_up_needed', 'application_acknowledged']);

// Classifications that are never actioned and never surfaced for review. We keep
// a lightweight tombstone (for poller dedup) instead of storing the email content.
// application_feedback covers surveys / "rate your candidate experience" emails —
// related to job searching but not a status change and not a to-do, so they're
// dropped rather than auto-creating a phantom application.
const IGNORE_CLASSIFICATIONS = new Set(['unrelated', 'job_alert', 'application_feedback']);

interface AppSummary {
  appId: string;
  company: string;
  role: string;
  status: string;
  appliedAt: string;
}

export const VALID_STATUSES = new Set([
  'applied', 'screening', 'online_assessment', 'phone_interview', 'technical_interview', 'onsite', 'offer',
  'accepted', 'rejected', 'withdrawn', 'ghosted',
]);

// ATS and recruiting platforms that send on behalf of companies
const ATS_DOMAINS = new Set([
  'greenhouse', 'lever', 'workday', 'taleo', 'icims', 'jobvite', 'smartrecruiters',
  'ashbyhq', 'myworkdayjobs', 'successfactors', 'brassring', 'jazz', 'recruitee',
  'bamboohr', 'rippling', 'gusto', 'linkedin', 'indeed', 'glassdoor',
]);

function extractSenderDomain(sender: string): string {
  const match = sender.match(/@([\w.-]+)/);
  if (!match) return '';
  const parts = match[1].split('.');
  return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : '';
}

function isAtsDomain(domain: string): boolean {
  return ATS_DOMAINS.has(domain);
}

function domainMatchesCompany(domain: string, company: string): boolean {
  if (!domain || domain.length < 3) return false;
  const words = company.toLowerCase().split(/[\s,&.()\-]+/).filter(w => w.length >= 3);
  return words.some(word => word === domain || word.startsWith(domain));
}

async function getUserEmail(userId: string): Promise<string | null> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: keys.user(userId),
    ProjectionExpression: 'email',
  }));
  return (result.Item?.email as string | undefined) ?? null;
}

async function getUserApplications(userId: string): Promise<AppSummary[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'APP#' },
    ProjectionExpression: 'appId, company, #role, #status, appliedAt',
    ExpressionAttributeNames: { '#role': 'role', '#status': 'status' },
  }));
  return (result.Items ?? []) as AppSummary[];
}

function buildClassifierPrompt(msg: EmailSqsMessage, apps: AppSummary[]): string {
  const appList = apps
    .map(a => `- ${a.company} (${a.role}, status: ${a.status}) [id: ${a.appId}]`)
    .join('\n');
  return `Classify this email for a job applicant. Return ONLY valid JSON, no explanation.

Classification guide:
- rejection: company explicitly declining the applicant
- interview_request: company inviting the applicant to interview
- offer: company extending a job offer
- application_acknowledged: company or ATS confirming receipt of the application ("thank you for applying", "we've received your application", etc.) — no decision yet
- recruiter_outreach: a recruiter or person proactively reaching out about a role the applicant has NOT already applied to (e.g. "I came across your profile", "we have an opening that might interest you", "are you open to a new role?"). This is a lead to respond to, NOT a response to a submitted application — never treat it as a new application.
- job_alert: automated digest from a job board (LinkedIn, Indeed, Glassdoor, etc.) listing multiple openings — not a direct human message
- follow_up_needed: the email requires an action on an application the applicant ALREADY submitted (e.g. complete an assessment, send references, fill out a form, reply to schedule a call)
- application_feedback: a request for feedback or a survey about the application / hiring / interview process itself (e.g. "how was your application experience?", "rate your candidate experience", "help us improve our recruiting process") — not a decision and not an action that changes an application's status
- unrelated: not related to job searching

Matching guide (to find applicationId):
1. Match the sender domain or company name in the email against the application company
2. Match the role title in the subject line or body against the application role
3. Only set applicationId if BOTH company AND role match an application — partial matches should return null
4. The email may come from an ATS platform (Greenhouse, Lever, Workday, etc.) rather than the company directly — look for the company name in the subject or body

Email:
From: ${msg.sender}
Subject: ${msg.subject}
Body: ${msg.body ?? msg.snippet}

Active job applications:
${appList || '(none)'}

New application detection:
- If classification is one of (rejection, interview_request, offer, follow_up_needed, application_acknowledged) AND applicationId is null, populate "newApplication" — these classifications are by definition responses to a submitted application
- For rejection: the email being a rejection is proof enough — populate with whatever company/role information is available even if details are sparse
- For application_acknowledged: the email confirms a submission — populate with the company and role mentioned
- Populate "newApplication" with: company name (required), role title (or null if not mentioned), job URL from the email body (or null), and a brief note (or null)
- Set "newApplication" to null only if applicationId is already matched, or if the company name cannot be determined
- ALWAYS return null for "newApplication" when classification is recruiter_outreach, job_alert, application_feedback, or unrelated — none of these represent a submitted application

Return JSON with exactly these fields:
{
  "classification": "rejection" | "interview_request" | "offer" | "application_acknowledged" | "recruiter_outreach" | "job_alert" | "follow_up_needed" | "application_feedback" | "unrelated",
  "confidence": <number 0.0–1.0>,
  "applicationId": <matching appId string, or null>,
  "suggestedStatus": "rejected" | "screening" | "online_assessment" | "phone_interview" | "technical_interview" | "onsite" | "offer" | null,
  "newApplication": { "company": <string>, "role": <string or null>, "jobUrl": <string or null>, "notes": <string or null> } | null,
  "actionSummary": <string or null>,
  "actionDeadline": <string "YYYY-MM-DD" or null>
}

Notes:
- For application_acknowledged, always return null for suggestedStatus — it does not represent a pipeline stage change.
- For recruiter_outreach and application_feedback, always return null for suggestedStatus — neither changes an application's pipeline stage.
- For follow_up_needed, return null for suggestedStatus EXCEPT in these two cases: (a) the email is a recruiter or coordinator responding to an application the applicant already submitted in order to set up an initial call/screen — return "screening"; (b) the email invites the applicant to complete an online assessment, coding challenge, take-home, or skills test (e.g. HackerRank, Codility, CodeSignal, a timed online test) — return "online_assessment". Other asks like sending references, filling out forms, or scheduling logistics are NOT stage changes: return null. An online assessment is still a follow_up_needed action item (keep actionSummary/actionDeadline) — the suggested status is confirmed by the user in the review queue, never auto-applied.
- actionSummary and actionDeadline apply ONLY to follow_up_needed and recruiter_outreach (return null for every other classification). actionSummary is a short imperative phrase (≤ 8 words) describing what the applicant must do — for follow_up_needed e.g. "Complete the HackerRank assessment"; for recruiter_outreach e.g. "Reply to recruiter about Backend role". actionDeadline is the due date as YYYY-MM-DD if the email states one, otherwise null.`;
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
}

async function callGemini(prompt: string): Promise<string> {
  const { gemini } = await clientsPromise;
  if (!gemini) throw new Error('Gemini API key not configured');
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL });
  const response = await model.generateContent(prompt);
  return stripCodeFences(response.response.text().trim());
}

async function callClaude(prompt: string): Promise<string> {
  const { anthropic } = await clientsPromise;
  if (!anthropic) throw new Error('Claude API key not configured');
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
}

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  const raw = stripCodeFences(data.choices[0]?.message?.content ?? '');
  log('llm_raw_response', { provider: 'ollama', rawLength: raw.length });
  return raw;
}

async function callLLM(prompt: string): Promise<string> {
  const { gemini, anthropic } = await clientsPromise;
  if (gemini) return callGemini(prompt);
  if (anthropic) return callClaude(prompt);
  return callOllama(prompt);
}

async function classifyWithLLM(
  msg: EmailSqsMessage,
  apps: AppSummary[],
): Promise<ClassificationResult> {
  const prompt = buildClassifierPrompt(msg, apps);
  const text = await callLLM(prompt);
  let result: ClassificationResult;
  try {
    result = JSON.parse(text) as ClassificationResult;
  } catch {
    logError('llm_parse_error', new Error('JSON parse failed'), { msgId: msg.gmailMsgId, raw: text.slice(0, 500) });
    return { classification: 'unrelated', confidence: 0, applicationId: null, suggestedStatus: null, newApplication: null, actionSummary: null, actionDeadline: null };
  }

  log('llm_result_raw', {
    msgId: msg.gmailMsgId,
    classification: result.classification,
    confidence: result.confidence,
    applicationId: result.applicationId,
    newApplicationCompany: result.newApplication?.company ?? null,
    newApplicationRole: result.newApplication?.role ?? null,
  });

  // Sanitize
  result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
  if (result.suggestedStatus && !VALID_STATUSES.has(result.suggestedStatus)) {
    result.suggestedStatus = null;
  }
  // Acknowledgments confirm receipt only — no stage change
  if (result.classification === 'application_acknowledged') {
    result.suggestedStatus = null;
  }
  if (result.applicationId && !apps.find(a => a.appId === result.applicationId)) {
    result.applicationId = null;
  }
  // Discard newApplication if applicationId was matched (redundant) or company is missing
  if (result.applicationId || !result.newApplication?.company) {
    result.newApplication = null;
  }
  // Normalize the action fields — only follow_up_needed keeps them.
  const cleaned = cleanActionFields(result.classification, result.actionSummary, result.actionDeadline);
  result.actionSummary = cleaned.actionSummary;
  result.actionDeadline = cleaned.actionDeadline;

  return result;
}

async function applyStatusUpdate(userId: string, appId: string, newStatus: string): Promise<void> {
  const current = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: keys.application(userId, appId),
  }));
  if (!current.Item) return;

  const now = new Date().toISOString();
  const appliedAt = current.Item.appliedAt as string;
  const gsi1 = gsi1Keys(userId, newStatus, appliedAt);
  const gsi2 = gsi2Keys(userId, now);

  const setClauses = [
    '#status = :status',
    'lastActivityAt = :now',
    'GSI1PK = :g1pk',
    'GSI1SK = :g1sk',
    'GSI2PK = :g2pk',
    'GSI2SK = :g2sk',
  ];
  const values: Record<string, unknown> = {
    ':status': newStatus,
    ':now': now,
    ':g1pk': gsi1.GSI1PK,
    ':g1sk': gsi1.GSI1SK,
    ':g2pk': gsi2.GSI2PK,
    ':g2sk': gsi2.GSI2SK,
  };
  // Record the auto-applied transition, but only if it changes the status.
  if (newStatus !== current.Item.status) {
    const append = appendStatusHistory({ status: newStatus, at: now, source: 'email_auto' });
    setClauses.push(append.set);
    Object.assign(values, append.values);
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.application(userId, appId),
    UpdateExpression: `SET ${setClauses.join(', ')}`,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: values,
  }));
}

async function createApplicationFromEmail(
  userId: string,
  newApp: NewApplicationData,
  receivedAt: string,
  initialStatus: string,
): Promise<string> {
  const appId = crypto.randomUUID();
  const now = new Date().toISOString();
  const appliedAt = receivedAt;
  const gsi1 = gsi1Keys(userId, initialStatus, appliedAt);
  const gsi2 = gsi2Keys(userId, now);

  const item: Record<string, unknown> = {
    ...keys.application(userId, appId),
    ...gsi1,
    ...gsi2,
    appId,
    company: newApp.company,
    role: newApp.role ?? 'Unknown Role',
    status: initialStatus,
    appliedAt,
    lastActivityAt: now,
    createdAt: now,
    autoCreated: true,
    // Seed with the apply event; if the email already implies a later status
    // (e.g. a rejection arrived for an untracked app), record that transition too.
    statusHistory:
      initialStatus === 'applied'
        ? [{ status: 'applied', at: appliedAt, source: 'created' as const }]
        : [
            { status: 'applied', at: appliedAt, source: 'created' as const },
            { status: initialStatus, at: now, source: 'email_auto' as const },
          ],
  };
  if (newApp.jobUrl) item.jobUrl = newApp.jobUrl;
  const dateNote =
    initialStatus === 'rejected'
      ? 'Application date estimated from rejection email — actual apply date unknown.'
      : null;
  const combinedNotes = [newApp.notes, dateNote].filter(Boolean).join(' ') || null;
  if (combinedNotes) item.notes = combinedNotes;

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  log('auto_created', { appId, company: newApp.company, role: item.role, status: initialStatus });
  return appId;
}

export async function processRecord(msg: EmailSqsMessage): Promise<void> {
  const { userId, gmailMsgId, sender, subject, snippet, body, receivedAt } = msg;

  log('email_received', { msgId: gmailMsgId, senderDomain: extractSenderDomain(sender), subject });

  const [apps, userEmail] = await Promise.all([
    getUserApplications(userId),
    getUserEmail(userId),
  ]);

  log('apps_loaded', { msgId: gmailMsgId, appCount: apps.length });

  const result = await classifyWithLLM({ userId, gmailMsgId, sender, subject, snippet, body, receivedAt }, apps);

  log('classified', {
    msgId: gmailMsgId,
    classification: result.classification,
    confidence: result.confidence,
    applicationId: result.applicationId,
    hasNewApplication: !!result.newApplication,
    newApplicationCompany: result.newApplication?.company ?? null,
  });

  // Ignored classifications (recruiter outreach, unrelated, job alerts) are never
  // actioned or reviewed. Don't persist the email content — overwrite the poller's
  // reservation record with a minimal tombstone so dedup (isAlreadyProcessed) keeps
  // skipping this message on future polls without re-spending an LLM classification.
  if (IGNORE_CLASSIFICATIONS.has(result.classification)) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.email(userId, gmailMsgId),
      UpdateExpression: 'SET classification = :cls, #emailStatus = :emailStatus, classifiedAt = :now',
      ExpressionAttributeNames: { '#emailStatus': 'status' },
      ExpressionAttributeValues: {
        ':cls': result.classification,
        ':emailStatus': 'ignored',
        ':now': new Date().toISOString(),
      },
    }));
    log('email_ignored', { msgId: gmailMsgId, classification: result.classification });
    return;
  }

  // Auto-create application when the email is clearly a response to an unlisted application.
  // Gated on confidence >= 0.8 — low-confidence emails go to manual review instead.
  const shouldAutoCreate =
    result.applicationId === null &&
    result.newApplication !== null &&
    AUTO_CREATE_CLASSIFICATIONS.has(result.classification) &&
    result.confidence >= 0.8;

  if (!shouldAutoCreate) {
    const reason = result.applicationId !== null
      ? 'already_matched'
      : result.newApplication === null
        ? 'no_new_application_data'
        : result.confidence < 0.8
          ? 'low_confidence'
          : 'classification_not_eligible';
    log('auto_create_skip', { msgId: gmailMsgId, classification: result.classification, reason });
  }

  let wasAutoCreated = false;

  if (shouldAutoCreate && result.newApplication) {
    wasAutoCreated = true;
    const initialStatus = result.suggestedStatus ?? (result.classification === 'rejection' ? 'rejected' : 'applied');
    log('auto_create_attempt', { msgId: gmailMsgId, company: result.newApplication.company, role: result.newApplication.role, status: initialStatus });
    const newAppId = await createApplicationFromEmail(userId, result.newApplication, receivedAt, initialStatus);
    result.applicationId = newAppId;
    // Status already set at creation — no need for a second applyStatusUpdate
    result.suggestedStatus = null;
  }

  const autoApply =
    result.confidence >= 0.8 &&
    result.applicationId !== null &&
    result.suggestedStatus !== null &&
    ['rejection', 'interview_request', 'offer'].includes(result.classification);

  // recruiter_outreach now flows here (it's no longer ignored): a lead the applicant
  // should respond to, surfaced as an action item. unrelated/job_alert/application_feedback
  // are already short-circuited by the IGNORE branch above; the guards stay as defense.
  const needsReview =
    !autoApply &&
    !wasAutoCreated &&
    result.classification !== 'unrelated' &&
    result.classification !== 'job_alert' &&
    result.classification !== 'application_feedback';

  // Write final email record
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.email(userId, gmailMsgId),
    UpdateExpression: [
      'SET gmailMsgId = :msgId',
      'sender = :sender',
      '#subject = :subject',
      'snippet = :snippet',
      'receivedAt = :receivedAt',
      'classification = :cls',
      'confidence = :conf',
      'applicationId = :appId',
      'suggestedStatus = :status',
      'actionSummary = :actionSummary',
      'actionDeadline = :actionDeadline',
      'needsReview = :needsReview',
      'reviewed = :reviewed',
      '#emailStatus = :emailStatus',
      'classifiedAt = :now',
    ].join(', '),
    ExpressionAttributeNames: { '#subject': 'subject', '#emailStatus': 'status' },
    ExpressionAttributeValues: {
      ':msgId': gmailMsgId,
      ':sender': sender,
      ':subject': subject,
      ':snippet': snippet,
      ':receivedAt': receivedAt,
      ':cls': result.classification,
      ':conf': result.confidence,
      ':appId': result.applicationId ?? null,
      ':status': result.suggestedStatus ?? null,
      ':actionSummary': result.actionSummary ?? null,
      ':actionDeadline': result.actionDeadline ?? null,
      ':needsReview': needsReview,
      ':reviewed': false,
      ':emailStatus': 'classified',
      ':now': new Date().toISOString(),
    },
  }));

  log('email_processed', {
    msgId: gmailMsgId,
    classification: result.classification,
    applicationId: result.applicationId,
    autoApply,
    needsReview,
  });

  // Auto-apply high-confidence status updates (only for pre-existing applications)
  if (autoApply && result.applicationId && result.suggestedStatus) {
    await applyStatusUpdate(userId, result.applicationId, result.suggestedStatus);
    log('status_updated', { msgId: gmailMsgId, appId: result.applicationId, status: result.suggestedStatus });

    const notifiableClassification = result.classification === 'offer' || result.classification === 'interview_request'
      ? result.classification
      : null;
    if (notifiableClassification && userEmail) {
      const matchedApp = apps.find(a => a.appId === result.applicationId);
      if (matchedApp) {
        await sendClassificationNotification(
          userEmail,
          notifiableClassification,
          matchedApp.company,
          matchedApp.role,
        );
      }
    }
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  // FIFO ordering matters here: `processRecord` re-reads the user's applications
  // on every call to decide whether an inbound email matches an existing app or
  // should auto-create one. Processing a group's records concurrently let two
  // emails from the same untracked company both auto-create an application
  // (each ran before the other's write landed). Group by MessageGroupId (== the
  // user id set by the poller), run the groups in parallel, but the records
  // within a group strictly in order, one at a time.
  const groups = new Map<string, SQSRecord[]>();
  for (const record of event.Records) {
    const groupId = record.attributes?.MessageGroupId ?? record.messageId;
    const arr = groups.get(groupId) ?? [];
    arr.push(record);
    groups.set(groupId, arr);
  }

  await Promise.allSettled(
    [...groups.values()].map(async records => {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        try {
          const msg = JSON.parse(record.body) as EmailSqsMessage;
          await processRecord(msg);
        } catch (err) {
          logError('record_failed', err, { sqsMessageId: record.messageId });
          // FIFO: once a record in a group fails, fail it and every later record
          // in the same group so SQS redelivers them in their original order.
          for (let j = i; j < records.length; j++) {
            batchItemFailures.push({ itemIdentifier: records[j].messageId });
          }
          break;
        }
      }
    }),
  );

  return { batchItemFailures };
};
