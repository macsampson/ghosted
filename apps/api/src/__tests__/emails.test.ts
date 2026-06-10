import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { listEmails, confirmEmail, dismissEmail } from '../handlers/emails';
import { createApplication } from '../handlers/applications';
import { makeEvent, body, parse } from './helpers';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

const USER = 'user-emails-test';

async function seedEmail(overrides: Record<string, unknown> = {}) {
  const emailId = `msg-${crypto.randomUUID()}`;
  const item = {
    ...keys.email(USER, emailId),
    gmailMsgId: emailId,
    sender: 'recruiter@stripe.com',
    subject: 'Your application',
    snippet: 'We wanted to let you know...',
    receivedAt: new Date().toISOString(),
    classification: 'rejection',
    confidence: 0.65,
    applicationId: null,
    suggestedStatus: 'rejected',
    needsReview: true,
    reviewed: false,
    status: 'classified',
    ...overrides,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

beforeEach(clearTable);

describe('listEmails', () => {
  it('returns empty array when there are no emails', async () => {
    const res = await listEmails(makeEvent({ userId: USER, httpMethod: 'GET', queryStringParameters: { needsReview: 'true' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toHaveLength(0);
  });

  it('returns emails needing review', async () => {
    await seedEmail({ needsReview: true });
    await seedEmail({ needsReview: false }); // already reviewed, should be excluded
    const res = await listEmails(makeEvent({ userId: USER, httpMethod: 'GET', queryStringParameters: { needsReview: 'true' } }));
    expect(parse(res)).toHaveLength(1);
  });

  it('returns all emails when needsReview filter is not set', async () => {
    await seedEmail({ needsReview: true });
    await seedEmail({ needsReview: false });
    const res = await listEmails(makeEvent({ userId: USER, httpMethod: 'GET' }));
    expect(parse(res)).toHaveLength(2);
  });

  it('is scoped to the requesting user', async () => {
    await seedEmail();
    const res = await listEmails(makeEvent({ userId: 'other-user', httpMethod: 'GET', queryStringParameters: { needsReview: 'true' } }));
    expect(parse(res)).toHaveLength(0);
  });
});

describe('dismissEmail', () => {
  it('marks the email as reviewed and not needing review', async () => {
    const email = await seedEmail({ needsReview: true });
    const res = await dismissEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: email.gmailMsgId },
    }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).dismissed).toBe(true);

    const list = await listEmails(makeEvent({ userId: USER, httpMethod: 'GET', queryStringParameters: { needsReview: 'true' } }));
    expect(parse(list)).toHaveLength(0);
  });

  it('returns 404 for an unknown emailId', async () => {
    const res = await dismissEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: 'nonexistent' },
    }));
    expect(res.statusCode).toBe(404);
  });
});

describe('confirmEmail', () => {
  it('marks the email reviewed and removes it from the review queue', async () => {
    const email = await seedEmail({ needsReview: true, applicationId: null });
    const res = await confirmEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: email.gmailMsgId },
    }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).confirmed).toBe(true);

    const list = await listEmails(makeEvent({ userId: USER, httpMethod: 'GET', queryStringParameters: { needsReview: 'true' } }));
    expect(parse(list)).toHaveLength(0);
  });

  it('applies the suggested status to the linked application', async () => {
    const app = parse(await createApplication(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ company: 'Stripe', role: 'SWE', status: 'applied', appliedAt: '2024-01-01T00:00:00.000Z' }),
    })));

    const email = await seedEmail({
      needsReview: true,
      applicationId: app.appId,
      suggestedStatus: 'rejected',
      classification: 'rejection',
    });

    await confirmEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: email.gmailMsgId },
    }));

    const { getApplication } = await import('../handlers/applications');
    const updated = parse(await getApplication(makeEvent({
      userId: USER,
      httpMethod: 'GET',
      pathParameters: { appId: app.appId },
    })));
    expect(updated.status).toBe('rejected');
  });

  it('advances a follow_up_needed email to screening and records the transition', async () => {
    const app = parse(await createApplication(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ company: 'Datadog', role: 'SWE', status: 'applied', appliedAt: '2024-01-01T00:00:00.000Z' }),
    })));

    const email = await seedEmail({
      needsReview: true,
      applicationId: app.appId,
      classification: 'follow_up_needed',
      suggestedStatus: 'screening',
      actionSummary: 'Reply to the recruiter to schedule a screen',
    });

    await confirmEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: email.gmailMsgId },
    }));

    const { getApplication } = await import('../handlers/applications');
    const updated = parse(await getApplication(makeEvent({
      userId: USER,
      httpMethod: 'GET',
      pathParameters: { appId: app.appId },
    })));
    expect(updated.status).toBe('screening');
    expect(updated.statusHistory.at(-1)).toMatchObject({ status: 'screening', source: 'email_confirmed' });
  });

  it('returns 404 for an unknown emailId', async () => {
    const res = await confirmEmail(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      pathParameters: { emailId: 'ghost' },
    }));
    expect(res.statusCode).toBe(404);
  });
});
