import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys } from '../lib/dynamo';
import {
  getGhostCandidates,
  getPendingReviewAppIds,
  ghostApplications,
  getStaleApplications,
} from '../handlers/stale-digest';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

const USER = 'user-autoghost-test';
const APPLIED_AT = '2024-01-01T00:00:00.000Z';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedApp(appId: string, status: string, lastActivityAt: string) {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...keys.application(USER, appId),
      ...gsi1Keys(USER, status, APPLIED_AT),
      ...gsi2Keys(USER, lastActivityAt),
      appId,
      company: 'Acme',
      role: 'Engineer',
      status,
      appliedAt: APPLIED_AT,
      lastActivityAt,
      createdAt: APPLIED_AT,
    },
  }));
}

async function seedPendingEmail(emailId: string, applicationId: string) {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `USER#${USER}`,
      SK: `EMAIL#${emailId}`,
      gmailMsgId: emailId,
      applicationId,
      needsReview: true,
      reviewed: false,
    },
  }));
}

beforeEach(clearTable);

describe('getGhostCandidates', () => {
  it('returns a pipeline app idle for 31 days', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    const candidates = await getGhostCandidates(USER, new Date());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].appId).toBe('app-1');
  });

  it('does not return a pipeline app idle for only 29 days', async () => {
    await seedApp('app-1', 'applied', daysAgo(29));
    const candidates = await getGhostCandidates(USER, new Date());
    expect(candidates).toHaveLength(0);
  });

  it('does not return terminal-status apps', async () => {
    await seedApp('app-1', 'rejected', daysAgo(31));
    const candidates = await getGhostCandidates(USER, new Date());
    expect(candidates).toHaveLength(0);
  });

  it('returns multiple candidates', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    await seedApp('app-2', 'screening', daysAgo(45));
    const candidates = await getGhostCandidates(USER, new Date());
    expect(candidates).toHaveLength(2);
  });
});

describe('getPendingReviewAppIds', () => {
  it('returns app ids linked to pending review emails', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    await seedPendingEmail('email-1', 'app-1');
    const ids = await getPendingReviewAppIds(USER);
    expect(ids.has('app-1')).toBe(true);
  });

  it('returns an empty set when no pending emails exist', async () => {
    const ids = await getPendingReviewAppIds(USER);
    expect(ids.size).toBe(0);
  });
});

describe('ghostApplications', () => {
  it('marks a stale pipeline app as ghosted and stamps ghostedAt', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    await ghostApplications(USER, candidates, new Set(), now);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(USER, 'app-1'),
    }));
    expect(result.Item?.status).toBe('ghosted');
    expect(result.Item?.ghostedAt).toBeTruthy();
    expect(result.Item?.GSI1SK).toBe(`STATUS#ghosted#${APPLIED_AT}`);
    expect(result.Item?.GSI2PK).toBeUndefined();
    expect(result.Item?.GSI2SK).toBeUndefined();
  });

  it('skips an app that has a pending review email', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    await seedPendingEmail('email-1', 'app-1');
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    const pendingIds = await getPendingReviewAppIds(USER);
    await ghostApplications(USER, candidates, pendingIds, now);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(USER, 'app-1'),
    }));
    expect(result.Item?.status).toBe('applied');
  });

  it('ghosts multiple candidates in a single run', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    await seedApp('app-2', 'screening', daysAgo(45));
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    await ghostApplications(USER, candidates, new Set(), now);

    const [r1, r2] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.application(USER, 'app-1') })),
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.application(USER, 'app-2') })),
    ]);
    expect(r1.Item?.status).toBe('ghosted');
    expect(r2.Item?.status).toBe('ghosted');
  });

  it('leaves terminal-status apps unchanged (they are never candidates)', async () => {
    await seedApp('app-1', 'rejected', daysAgo(31));
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    await ghostApplications(USER, candidates, new Set(), now);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(USER, 'app-1'),
    }));
    expect(result.Item?.status).toBe('rejected');
  });

  it('never ghosts an accepted app, even when idle past the ghost threshold', async () => {
    await seedApp('app-1', 'accepted', daysAgo(60));
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    await ghostApplications(USER, candidates, new Set(), now);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(USER, 'app-1'),
    }));
    expect(result.Item?.status).toBe('accepted');
  });
});

describe('integration: ghosted apps are excluded from the stale digest', () => {
  it('does not include a just-ghosted app in the 14-day stale list', async () => {
    await seedApp('app-1', 'applied', daysAgo(31));
    const now = new Date();
    const candidates = await getGhostCandidates(USER, now);
    await ghostApplications(USER, candidates, new Set(), now);

    const stale = await getStaleApplications(USER, now);
    expect(stale.find(a => a.company === 'Acme')).toBeUndefined();
  });
});
