import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Anthropic from '@anthropic-ai/sdk';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys } from '../lib/dynamo';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

interface EmailSqsMessage {
  userId: string;
  gmailMsgId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

interface ClassificationResult {
  classification: 'rejection' | 'interview_request' | 'offer' | 'recruiter_outreach' | 'follow_up_needed' | 'unrelated';
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

function extractSenderDomain(sender: string): string {
  const match = sender.match(/@([\w.-]+)/);
  if (!match) return '';
  const parts = match[1].split('.');
  return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : '';
}

function domainMatchesCompany(domain: string, company: string): boolean {
  if (!domain || domain.length < 3) return false;
  // Split into words and check for equality or prefix match — avoids substring false positives
  // (e.g. 'io' should not match 'Notion' even though 'io' appears inside 'notion').
  const words = company.toLowerCase().split(/[\s,&.()\-]+/).filter(w => w.length >= 3);
  return words.some(word => word === domain || word.startsWith(domain));
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

async function classifyWithClaude(
  msg: EmailSqsMessage,
  apps: AppSummary[],
): Promise<ClassificationResult> {
  const appList = apps
    .map(a => `- ${a.company} (${a.role}, status: ${a.status}) [id: ${a.appId}]`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Classify this email for a job applicant. Return ONLY valid JSON, no explanation.

Email:
From: ${msg.sender}
Subject: ${msg.subject}
Snippet: ${msg.snippet}

Active job applications:
${appList || '(none)'}

Return JSON with exactly these fields:
{
  "classification": "rejection" | "interview_request" | "offer" | "recruiter_outreach" | "follow_up_needed" | "unrelated",
  "confidence": <number 0.0–1.0>,
  "applicationId": <matching appId string, or null>,
  "suggestedStatus": "rejected" | "screening" | "phone_interview" | "technical_interview" | "onsite" | "offer" | null
}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const result = JSON.parse(text) as ClassificationResult;

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

async function processRecord(msg: EmailSqsMessage): Promise<void> {
  const { userId, gmailMsgId, sender, subject, snippet, receivedAt } = msg;

  const apps = await getUserApplications(userId);
  const senderDomain = extractSenderDomain(sender);
  const matchingApps = apps.filter(a => domainMatchesCompany(senderDomain, a.company));

  let result: ClassificationResult;

  // Heuristic pre-filter: skip Claude if sender has no plausible company match
  if (apps.length > 0 && matchingApps.length === 0 && senderDomain) {
    result = { classification: 'unrelated', confidence: 0.95, applicationId: null, suggestedStatus: null };
  } else {
    const contextApps = matchingApps.length > 0 ? matchingApps : apps;
    result = await classifyWithClaude({ userId, gmailMsgId, sender, subject, snippet, receivedAt }, contextApps);
  }

  const autoApply =
    result.confidence >= 0.8 &&
    result.applicationId !== null &&
    result.suggestedStatus !== null &&
    ['rejection', 'interview_request', 'offer'].includes(result.classification);

  const needsReview = !autoApply && result.classification !== 'unrelated';

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
