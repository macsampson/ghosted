import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Anthropic from '@anthropic-ai/sdk';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys } from '../lib/dynamo';
import { getSecrets } from '../lib/secrets';
import { sendClassificationNotification } from './notifier';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e2b';

// Pre-load at cold start; null means fall back to Ollama.
const anthropicPromise = getSecrets().then(s =>
  s.claudeApiKey ? new Anthropic({ apiKey: s.claudeApiKey }) : null,
);

interface EmailSqsMessage {
  userId: string;
  gmailMsgId: string;
  sender: string;
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
}

interface ClassificationResult {
  classification: 'rejection' | 'interview_request' | 'offer' | 'recruiter_outreach' | 'job_alert' | 'follow_up_needed' | 'unrelated';
  confidence: number;
  applicationId: string | null;
  suggestedStatus: string | null;
}

interface AppSummary {
  appId: string;
  company: string;
  role: string;
  status: string;
  appliedAt: string;
}

const VALID_STATUSES = new Set([
  'applied', 'screening', 'phone_interview', 'technical_interview', 'onsite', 'offer',
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
- recruiter_outreach: a recruiter or person reaching out about a specific role
- job_alert: automated digest from a job board (LinkedIn, Indeed, Glassdoor, etc.) listing multiple openings — not a direct human message
- follow_up_needed: requires action from the applicant
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

Return JSON with exactly these fields:
{
  "classification": "rejection" | "interview_request" | "offer" | "recruiter_outreach" | "job_alert" | "follow_up_needed" | "unrelated",
  "confidence": <number 0.0–1.0>,
  "applicationId": <matching appId string, or null>,
  "suggestedStatus": "rejected" | "screening" | "phone_interview" | "technical_interview" | "onsite" | "offer" | null
}`;
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
}

async function callClaude(prompt: string): Promise<string> {
  const anthropic = await anthropicPromise;
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
  console.log('[classifier] ollama raw response:', raw);
  return raw;
}

async function classifyWithClaude(
  msg: EmailSqsMessage,
  apps: AppSummary[],
): Promise<ClassificationResult> {
  const prompt = buildClassifierPrompt(msg, apps);
  const text = (await anthropicPromise) ? await callClaude(prompt) : await callOllama(prompt);
  let result: ClassificationResult;
  try {
    result = JSON.parse(text) as ClassificationResult;
  } catch {
    console.error('[classifier] failed to parse response, treating as unrelated. raw:', text);
    return { classification: 'unrelated', confidence: 0, applicationId: null, suggestedStatus: null };
  }

  // Sanitize
  result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
  if (result.suggestedStatus && !VALID_STATUSES.has(result.suggestedStatus)) {
    result.suggestedStatus = null;
  }
  if (result.applicationId && !apps.find(a => a.appId === result.applicationId)) {
    result.applicationId = null;
  }

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

  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.application(userId, appId),
    UpdateExpression: [
      'SET #status = :status',
      'lastActivityAt = :now',
      'GSI1PK = :g1pk',
      'GSI1SK = :g1sk',
      'GSI2PK = :g2pk',
      'GSI2SK = :g2sk',
    ].join(', '),
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':now': now,
      ':g1pk': gsi1.GSI1PK,
      ':g1sk': gsi1.GSI1SK,
      ':g2pk': gsi2.GSI2PK,
      ':g2sk': gsi2.GSI2SK,
    },
  }));
}

export async function processRecord(msg: EmailSqsMessage): Promise<void> {
  const { userId, gmailMsgId, sender, subject, snippet, body, receivedAt } = msg;

  const [apps, userEmail] = await Promise.all([
    getUserApplications(userId),
    getUserEmail(userId),
  ]);
  const senderDomain = extractSenderDomain(sender);
  const domainMatchedApps = apps.filter(a => domainMatchesCompany(senderDomain, a.company));
  const fromAts = isAtsDomain(senderDomain);

  let result: ClassificationResult;

  // Skip Claude only when sender has no plausible match and isn't an ATS platform
  if (apps.length > 0 && domainMatchedApps.length === 0 && senderDomain && !fromAts) {
    result = { classification: 'unrelated', confidence: 0.95, applicationId: null, suggestedStatus: null };
  } else {
    // ATS emails could be from any company — pass all apps so the model can match on role+body
    const contextApps = domainMatchedApps.length > 0 ? domainMatchedApps : apps;
    result = await classifyWithClaude({ userId, gmailMsgId, sender, subject, snippet, body, receivedAt }, contextApps);
  }

  const autoApply =
    result.confidence >= 0.8 &&
    result.applicationId !== null &&
    result.suggestedStatus !== null &&
    ['rejection', 'interview_request', 'offer'].includes(result.classification);

  const needsReview = !autoApply && result.classification !== 'unrelated' && result.classification !== 'job_alert';

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
      ':needsReview': needsReview,
      ':reviewed': false,
      ':emailStatus': 'classified',
      ':now': new Date().toISOString(),
    },
  }));

  // Auto-apply high-confidence status updates
  if (autoApply && result.applicationId && result.suggestedStatus) {
    await applyStatusUpdate(userId, result.applicationId, result.suggestedStatus);

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

  await Promise.allSettled(
    event.Records.map(async record => {
      try {
        const msg = JSON.parse(record.body) as EmailSqsMessage;
        await processRecord(msg);
      } catch (err) {
        console.error(`Failed to process record ${record.messageId}:`, err);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures };
};
