import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { ScanCommand, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { createApplication } from '../handlers/applications';
import { getUploadUrl } from '../handlers/resumes';
import { meterClassification, LIMITS } from '../lib/plan';
import { makeEvent, body, parse } from './helpers';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

async function setPlan(userId: string, plan: 'free' | 'pro') {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...keys.user(userId), plan, subscriptionStatus: plan === 'pro' ? 'active' : null },
  }));
}

function createApp(userId: string) {
  return createApplication(makeEvent({
    userId,
    httpMethod: 'POST',
    body: body({ company: 'Acme', role: 'Engineer' }),
  }));
}

function uploadResume(userId: string, label: string) {
  return getUploadUrl(makeEvent({
    userId,
    httpMethod: 'POST',
    body: body({ label, filename: 'resume.pdf' }),
  }));
}

// Enforcement is opt-in via env so it never affects the rest of the suite. Set it
// for this file only and restore afterwards (Vitest isolates files, but be tidy).
const prev = process.env.PLAN_LIMITS_ENABLED;
beforeAll(() => { process.env.PLAN_LIMITS_ENABLED = 'true'; });
afterAll(() => { process.env.PLAN_LIMITS_ENABLED = prev; });
beforeEach(clearTable);

describe('application limit', () => {
  it('blocks a free user once the cap is reached', async () => {
    const userId = 'free-apps';
    await setPlan(userId, 'free');
    for (let i = 0; i < LIMITS.applications; i++) {
      expect((await createApp(userId)).statusCode).toBe(201);
    }
    const res = await createApp(userId);
    expect(res.statusCode).toBe(402);
    const data = parse(res);
    expect(data.code).toBe('plan_limit');
    expect(data.limit).toBe(LIMITS.applications);
  });

  it('lets a pro user exceed the free cap', async () => {
    const userId = 'pro-apps';
    await setPlan(userId, 'pro');
    for (let i = 0; i < LIMITS.applications + 2; i++) {
      expect((await createApp(userId)).statusCode).toBe(201);
    }
  });
});

describe('resume limit', () => {
  it('blocks a second resume for a free user', async () => {
    const userId = 'free-resumes';
    await setPlan(userId, 'free');
    expect((await uploadResume(userId, 'A')).statusCode).toBe(201);
    const res = await uploadResume(userId, 'B');
    expect(res.statusCode).toBe(402);
    expect(parse(res).code).toBe('plan_limit');
  });

  it('lets a pro user upload multiple resumes', async () => {
    const userId = 'pro-resumes';
    await setPlan(userId, 'pro');
    expect((await uploadResume(userId, 'A')).statusCode).toBe(201);
    expect((await uploadResume(userId, 'B')).statusCode).toBe(201);
  });
});

describe('enforcement disabled', () => {
  it('does not block when PLAN_LIMITS_ENABLED is unset', async () => {
    process.env.PLAN_LIMITS_ENABLED = '';
    const userId = 'unenforced';
    await setPlan(userId, 'free');
    expect((await uploadResume(userId, 'A')).statusCode).toBe(201);
    expect((await uploadResume(userId, 'B')).statusCode).toBe(201);
    process.env.PLAN_LIMITS_ENABLED = 'true';
  });
});

describe('meterClassification', () => {
  it('allows up to the monthly cap then blocks', async () => {
    const userId = 'free-classify';
    await setPlan(userId, 'free');
    for (let i = 0; i < LIMITS.classificationsPerMonth; i++) {
      expect((await meterClassification(userId)).allowed).toBe(true);
    }
    expect((await meterClassification(userId)).allowed).toBe(false);
  });

  it('resets the counter on a new month', async () => {
    const userId = 'free-classify-reset';
    await setPlan(userId, 'free');
    const june = new Date('2026-06-15T00:00:00Z');
    for (let i = 0; i < LIMITS.classificationsPerMonth; i++) {
      await meterClassification(userId, june);
    }
    expect((await meterClassification(userId, june)).allowed).toBe(false);
    const july = new Date('2026-07-01T00:00:00Z');
    expect((await meterClassification(userId, july)).allowed).toBe(true);
  });

  it('never blocks a pro user', async () => {
    const userId = 'pro-classify';
    await setPlan(userId, 'pro');
    for (let i = 0; i < LIMITS.classificationsPerMonth + 5; i++) {
      expect((await meterClassification(userId)).allowed).toBe(true);
    }
  });
});
