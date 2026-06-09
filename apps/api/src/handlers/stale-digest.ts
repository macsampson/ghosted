import { ScanCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, appendStatusHistory } from '../lib/dynamo';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const FROM = process.env.SES_FROM_EMAIL;
const STALE_DAYS = 14;
const GHOST_DAYS = 30;

// `accepted` is a successful terminal outcome — it must never be treated as an
// active pipeline app, or the ghost/stale sweep would auto-rewrite it to
// `ghosted` after 30 days of (expected) inactivity.
const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'withdrawn', 'ghosted']);

export function isPipelineStatus(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

export function daysSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24);
}

export function isStaleApplication(
  app: { status: string; lastActivityAt: string },
  now: Date,
  daysThreshold: number,
): boolean {
  return isPipelineStatus(app.status) && daysSince(app.lastActivityAt, now) >= daysThreshold;
}

export function isGhostCandidate(
  app: { status: string; lastActivityAt: string },
  now: Date,
): boolean {
  return isPipelineStatus(app.status) && daysSince(app.lastActivityAt, now) >= GHOST_DAYS;
}

interface UserProfile {
  userId: string;
  email: string;
}

interface StaleApp {
  company: string;
  role: string;
  status: string;
  lastActivityAt: string;
}

export interface GhostCandidate {
  appId: string;
  appliedAt: string;
  status: string;
}

async function getAllUserProfiles(): Promise<UserProfile[]> {
  const profiles: UserProfile[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :profile',
      ExpressionAttributeValues: { ':profile': 'PROFILE' },
      ProjectionExpression: 'PK, email',
      ExclusiveStartKey: lastKey,
    }));

    for (const item of result.Items ?? []) {
      const userId = (item.PK as string).replace('USER#', '');
      if (item.email) {
        profiles.push({ userId, email: item.email as string });
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return profiles;
}

export async function getGhostCandidates(userId: string, now: Date): Promise<GhostCandidate[]> {
  const cutoff = new Date(now.getTime() - GHOST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidates: GhostCandidate[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK < :cutoff',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':cutoff': `LAST_ACTIVITY#${cutoff}`,
      },
      ProjectionExpression: 'SK, #status, appliedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of result.Items ?? []) {
      const sk = item.SK as string;
      if (!sk.startsWith('APP#')) continue;
      if (!isPipelineStatus(item.status as string)) continue;
      candidates.push({
        appId: sk.replace('APP#', ''),
        appliedAt: item.appliedAt as string,
        status: item.status as string,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return candidates;
}

export async function getPendingReviewAppIds(userId: string): Promise<Set<string>> {
  const appIds = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'needsReview = :yes',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': 'EMAIL#',
        ':yes': true,
      },
      ProjectionExpression: 'applicationId',
      ExclusiveStartKey: lastKey,
    }));

    for (const item of result.Items ?? []) {
      if (item.applicationId) appIds.add(item.applicationId as string);
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return appIds;
}

export async function ghostApplications(
  userId: string,
  candidates: GhostCandidate[],
  pendingAppIds: Set<string>,
  now: Date,
): Promise<void> {
  const cutoff = `LAST_ACTIVITY#${new Date(now.getTime() - GHOST_DAYS * 24 * 60 * 60 * 1000).toISOString()}`;

  await Promise.allSettled(
    candidates
      .filter(c => !pendingAppIds.has(c.appId))
      .map(async candidate => {
        try {
          const append = appendStatusHistory({
            status: 'ghosted',
            at: now.toISOString(),
            source: 'auto_ghosted',
          });
          await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `APP#${candidate.appId}` },
            UpdateExpression:
              `SET #status = :ghosted, GSI1SK = :gsi1sk, ghostedAt = :now, ${append.set} REMOVE GSI2PK, GSI2SK`,
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':ghosted': 'ghosted',
              ':gsi1sk': `STATUS#ghosted#${candidate.appliedAt}`,
              ':now': now.toISOString(),
              ':cutoff': cutoff,
              ...append.values,
            },
            ConditionExpression: 'attribute_exists(SK) AND GSI2SK < :cutoff',
          }));
        } catch (err: any) {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }
      }),
  );
}

export async function getStaleApplications(userId: string, now: Date): Promise<StaleApp[]> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stale: StaleApp[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK < :cutoff',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':cutoff': `LAST_ACTIVITY#${cutoff}`,
      },
      ProjectionExpression: 'company, #role, #status, lastActivityAt',
      ExpressionAttributeNames: { '#role': 'role', '#status': 'status' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of result.Items ?? []) {
      if (!isPipelineStatus(item.status as string)) continue;
      stale.push({
        company: item.company as string,
        role: item.role as string,
        status: item.status as string,
        lastActivityAt: item.lastActivityAt as string,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return stale;
}

function buildDigestBody(apps: StaleApp[], now: Date): string {
  const lines = apps.map(a => {
    const days = Math.floor(daysSince(a.lastActivityAt, now));
    return `• ${a.company} — ${a.role} (${a.status}, ${days}d idle)`;
  });
  return [
    `You have ${apps.length} application${apps.length === 1 ? '' : 's'} with no activity in ${STALE_DAYS}+ days:`,
    '',
    ...lines,
    '',
    'https://ghosted.macsampson.com',
  ].join('\n');
}

async function sendDigestEmail(toEmail: string, apps: StaleApp[], now: Date): Promise<void> {
  if (!FROM) return;
  await ses.send(
    new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: `Ghosted: ${apps.length} stale application${apps.length === 1 ? '' : 's'} need follow-up` },
        Body: { Text: { Data: buildDigestBody(apps, now) } },
      },
    }),
  );
}

export const handler = async (): Promise<void> => {
  const now = new Date();
  const profiles = await getAllUserProfiles();

  await Promise.allSettled(
    profiles.map(async ({ userId, email }) => {
      const [candidates, pendingAppIds] = await Promise.all([
        getGhostCandidates(userId, now),
        getPendingReviewAppIds(userId),
      ]);
      await ghostApplications(userId, candidates, pendingAppIds, now);
      const stale = await getStaleApplications(userId, now);
      if (stale.length > 0) {
        await sendDigestEmail(email, stale, now);
      }
    }),
  );
};
