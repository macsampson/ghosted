import type { ScheduledEvent } from 'aws-lambda';
import { ScanCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { decrypt } from '../lib/crypto';
import { processRecord } from './classifier';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.EMAIL_QUEUE_URL ?? '';
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? '';

interface GmailMessage {
  id: string;
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
  };
  internalDate: string;
}

async function refreshAccessToken(encryptedRefreshToken: string): Promise<string> {
  const refreshToken = decrypt(encryptedRefreshToken);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchRecentMessages(accessToken: string): Promise<{ id: string }[]> {
  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:12h+-in:sent&maxResults=20',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
  const data = await res.json() as { messages?: { id: string }[] };
  return data.messages ?? [];
}

async function fetchMessageMetadata(accessToken: string, msgId: string): Promise<GmailMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail fetch failed: ${res.status}`);
  return res.json() as Promise<GmailMessage>;
}

function headerValue(msg: GmailMessage, name: string): string {
  return msg.payload.headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

async function isAlreadyProcessed(userId: string, gmailMsgId: string): Promise<boolean> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: keys.email(userId, gmailMsgId),
  }));
  return !!result.Item;
}

async function processUser(userId: string, encryptedRefreshToken: string): Promise<void> {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const messageRefs = await fetchRecentMessages(accessToken);

  for (const { id: gmailMsgId } of messageRefs) {
    if (await isAlreadyProcessed(userId, gmailMsgId)) continue;

    // Reserve the record to prevent duplicate processing
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...keys.email(userId, gmailMsgId),
        gmailMsgId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })).catch(() => {
      // Race condition: another poller invocation already reserved this record — skip
    });

    // Fetch metadata and push to SQS for classification
    try {
      const msg = await fetchMessageMetadata(accessToken, gmailMsgId);
      const sender = headerValue(msg, 'From');
      const subject = headerValue(msg, 'Subject');
      const receivedAt = new Date(parseInt(msg.internalDate)).toISOString();

      await sqs.send(new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ userId, gmailMsgId, sender, subject, snippet: msg.snippet, receivedAt }),
        MessageGroupId: userId,
      }));
    } catch (err) {
      console.error(`Failed to queue message ${gmailMsgId} for user ${userId}:`, err);
    }
  }
}

export async function runPipelineForUser(
  userId: string,
  encryptedRefreshToken: string,
): Promise<{ processed: number; skipped: number }> {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const messageRefs = await fetchRecentMessages(accessToken);

  let processed = 0;
  let skipped = 0;

  for (const { id: gmailMsgId } of messageRefs) {
    if (await isAlreadyProcessed(userId, gmailMsgId)) {
      skipped++;
      continue;
    }

    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...keys.email(userId, gmailMsgId),
        gmailMsgId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })).catch(() => { });

    try {
      const msg = await fetchMessageMetadata(accessToken, gmailMsgId);
      const sender = headerValue(msg, 'From');
      const subject = headerValue(msg, 'Subject');
      const receivedAt = new Date(parseInt(msg.internalDate)).toISOString();
      await processRecord({ userId, gmailMsgId, sender, subject, snippet: msg.snippet, receivedAt });
      processed++;
    } catch (err) {
      console.error(`Failed to classify message ${gmailMsgId}:`, err);
    }
  }

  return { processed, skipped };
}

export const handler = async (_event: ScheduledEvent): Promise<void> => {
  // Scan for all users with Gmail connected
  const result = await ddb.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'SK = :profile AND attribute_exists(gmailRefreshToken)',
    ExpressionAttributeValues: { ':profile': 'PROFILE' },
    ProjectionExpression: 'PK, gmailRefreshToken',
  }));

  const users = (result.Items ?? []).map(item => ({
    userId: (item.PK as string).replace('USER#', ''),
    encryptedRefreshToken: item.gmailRefreshToken as string,
  }));

  await Promise.allSettled(
    users.map(({ userId, encryptedRefreshToken }) =>
      processUser(userId, encryptedRefreshToken).catch(err =>
        console.error(`Failed to process user ${userId}:`, err),
      ),
    ),
  );
};
