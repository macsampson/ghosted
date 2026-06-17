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

export interface ActionItem {
  actionSummary?: string;
  actionDeadline?: string;
  subject?: string;
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

// Open action-needed emails — to-dos the applicant still owes (follow_up_needed) and
// recruiter leads worth a reply (recruiter_outreach). Surfaced in the daily digest so
// time-sensitive asks (assessments, references, recruiter replies) aren't missed.
export async function getActionNeededItems(userId: string): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'needsReview = :yes AND classification IN (:followUp, :recruiter)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': 'EMAIL#',
        ':yes': true,
        ':followUp': 'follow_up_needed',
        ':recruiter': 'recruiter_outreach',
      },
      ProjectionExpression: 'actionSummary, actionDeadline, #subject',
      ExpressionAttributeNames: { '#subject': 'subject' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of result.Items ?? []) {
      items.push({
        actionSummary: item.actionSummary as string | undefined,
        actionDeadline: item.actionDeadline as string | undefined,
        subject: item.subject as string | undefined,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
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

export function buildDigestBody(apps: StaleApp[], actions: ActionItem[], now: Date): string {
  const sections: string[] = [];

  if (apps.length > 0) {
    sections.push(
      `You have ${apps.length} application${apps.length === 1 ? '' : 's'} with no activity in ${STALE_DAYS}+ days:`,
      '',
      ...apps.map(a => {
        const days = Math.floor(daysSince(a.lastActivityAt, now));
        return `• ${a.company} — ${a.role} (${a.status}, ${days}d idle)`;
      }),
    );
  }

  if (actions.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push(
      `${actions.length} email${actions.length === 1 ? '' : 's'} need${actions.length === 1 ? 's' : ''} action:`,
      '',
      ...actions.map(a => {
        const label = a.actionSummary || a.subject || 'Follow up';
        return a.actionDeadline ? `• ${label} (due ${a.actionDeadline})` : `• ${label}`;
      }),
    );
  }

  sections.push('', 'https://ghosted.macsampson.com');
  return sections.join('\n');
}

export function buildDigestSubject(staleCount: number, actionCount: number): string {
  if (staleCount > 0) {
    return `Ghosted: ${staleCount} stale application${staleCount === 1 ? '' : 's'} need follow-up`;
  }
  return `Ghosted: ${actionCount} email${actionCount === 1 ? '' : 's'} need${actionCount === 1 ? 's' : ''} action`;
}

async function sendDigestEmail(toEmail: string, apps: StaleApp[], actions: ActionItem[], now: Date): Promise<void> {
  if (!FROM) return;
  await ses.send(
    new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: buildDigestSubject(apps.length, actions.length) },
        Body: { Text: { Data: buildDigestBody(apps, actions, now) } },
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
      const [stale, actions] = await Promise.all([
        getStaleApplications(userId, now),
        getActionNeededItems(userId),
      ]);
      if (stale.length > 0 || actions.length > 0) {
        await sendDigestEmail(email, stale, actions, now);
      }
    }),
  );
};
