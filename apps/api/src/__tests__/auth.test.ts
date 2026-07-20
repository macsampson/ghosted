import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import { getProfile, startGmailAuth, gmailCallback } from '../handlers/auth';
import { makeEvent, parse } from './helpers';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

const USER = 'user-auth-test';

beforeEach(clearTable);

describe('getProfile', () => {
  it('returns gmailConnected: false for a user with no profile record', async () => {
    const res = await getProfile(makeEvent({ userId: USER, httpMethod: 'GET' }));
    expect(res.statusCode).toBe(200);
    const profile = parse(res);
    expect(profile.gmailConnected).toBe(false);
    expect(profile.sub).toBe(USER);
  });
});

describe('startGmailAuth (local dev mock)', () => {
  it('returns connected: true and writes a token to DynamoDB', async () => {
    const res = await startGmailAuth(makeEvent({ userId: USER, httpMethod: 'POST', body: '{}' }));
    expect(res.statusCode).toBe(200);
    const data = parse(res);
    expect(data.connected).toBe(true);
    expect(data.mock).toBe(true);
  });

  it('getProfile reflects gmailConnected: true after connect', async () => {
    await startGmailAuth(makeEvent({ userId: USER, httpMethod: 'POST', body: '{}' }));
    const res = await getProfile(makeEvent({ userId: USER, httpMethod: 'GET' }));
    expect(parse(res).gmailConnected).toBe(true);
  });

  it('users are isolated — connecting one user does not affect another', async () => {
    await startGmailAuth(makeEvent({ userId: USER, httpMethod: 'POST', body: '{}' }));
    const other = await getProfile(makeEvent({ userId: 'other-user', httpMethod: 'GET' }));
    expect(parse(other).gmailConnected).toBe(false);
  });
});

describe('gmailCallback state validation', () => {
  const callbackEvent = (query: Record<string, string> | null) =>
    makeEvent({ httpMethod: 'GET', path: '/auth/gmail/callback', queryStringParameters: query });

  it('rejects an expired state and still deletes the single-use record', async () => {
    const state = 'expired-state-123';
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: 'OAUTH_STATE', SK: state, sub: USER, expiresAt: Math.floor(Date.now() / 1000) - 10 },
    }));

    const res = await gmailCallback(callbackEvent({ code: 'auth-code', state }));

    expect(res.statusCode).toBe(302);
    expect(res.headers?.Location).toContain('error=expired_state');
    const after = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'OAUTH_STATE', SK: state },
    }));
    expect(after.Item).toBeUndefined();
  });

  it('rejects an unknown state', async () => {
    const res = await gmailCallback(callbackEvent({ code: 'auth-code', state: 'never-issued' }));
    expect(res.statusCode).toBe(302);
    expect(res.headers?.Location).toContain('error=invalid_state');
  });

  it('redirects with missing_params when code or state is absent', async () => {
    const res = await gmailCallback(callbackEvent({ state: 'only-state' }));
    expect(res.headers?.Location).toContain('error=missing_params');
  });
});
