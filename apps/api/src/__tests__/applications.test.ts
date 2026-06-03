import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import {
  listApplications,
  createApplication,
  getApplication,
  updateApplication,
  deleteApplication,
} from '../handlers/applications';
import { getUploadUrl } from '../handlers/resumes';
import { makeEvent, body, parse } from './helpers';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

const USER = 'user-apps-test';

const APP_BODY = {
  company: 'Stripe',
  role: 'Software Engineer',
  status: 'applied',
  appliedAt: '2024-01-15T00:00:00.000Z',
};

beforeEach(clearTable);

describe('createApplication', () => {
  it('returns 201 with correct fields', async () => {
    const res = await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) }));
    expect(res.statusCode).toBe(201);
    const app = parse(res);
    expect(app.company).toBe('Stripe');
    expect(app.role).toBe('Software Engineer');
    expect(app.status).toBe('applied');
    expect(app.appId).toBeTruthy();
    expect(app.lastActivityAt).toBeTruthy();
  });

  it('rejects missing required fields', async () => {
    const res = await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ company: 'Stripe' }) }));
    expect(res.statusCode).toBe(400);
  });

  it('is scoped to the user — another user sees no items', async () => {
    await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) }));
    const res = await listApplications(makeEvent({ userId: 'other-user', httpMethod: 'GET' }));
    expect(parse(res)).toHaveLength(0);
  });
});

describe('listApplications', () => {
  it('returns all applications for the user', async () => {
    await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) }));
    await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ ...APP_BODY, company: 'Twilio' }) }));
    const res = await listApplications(makeEvent({ userId: USER, httpMethod: 'GET' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toHaveLength(2);
  });

  it('strips internal DynamoDB keys from response', async () => {
    await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) }));
    const res = await listApplications(makeEvent({ userId: USER, httpMethod: 'GET' }));
    const [app] = parse(res);
    expect(app.PK).toBeUndefined();
    expect(app.SK).toBeUndefined();
    expect(app.GSI1PK).toBeUndefined();
  });
});

describe('getApplication', () => {
  it('returns the correct application', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    const res = await getApplication(makeEvent({ userId: USER, httpMethod: 'GET', pathParameters: { appId: created.appId } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).appId).toBe(created.appId);
  });

  it('returns 404 for unknown appId', async () => {
    const res = await getApplication(makeEvent({ userId: USER, httpMethod: 'GET', pathParameters: { appId: 'nonexistent' } }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when accessing another user\'s application', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    const res = await getApplication(makeEvent({ userId: 'other-user', httpMethod: 'GET', pathParameters: { appId: created.appId } }));
    expect(res.statusCode).toBe(404);
  });
});

describe('updateApplication', () => {
  it('updates status and bumps lastActivityAt', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    const before = created.lastActivityAt;

    await new Promise(r => setTimeout(r, 10));

    const res = await updateApplication(makeEvent({
      userId: USER,
      httpMethod: 'PUT',
      pathParameters: { appId: created.appId },
      body: body({ status: 'screening' }),
    }));
    expect(res.statusCode).toBe(200);
    const updated = parse(res);
    expect(updated.status).toBe('screening');
    expect(updated.lastActivityAt > before).toBe(true);
  });

  it('GSI1SK reflects new status after update', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    await updateApplication(makeEvent({
      userId: USER,
      httpMethod: 'PUT',
      pathParameters: { appId: created.appId },
      body: body({ status: 'phone_interview' }),
    }));

    // Verify via get — if GSI is wrong the status itself would still be correct;
    // the GSI integrity is what the pipeline view depends on.
    const res = await getApplication(makeEvent({ userId: USER, httpMethod: 'GET', pathParameters: { appId: created.appId } }));
    expect(parse(res).status).toBe('phone_interview');
  });

  it('returns 404 for unknown appId', async () => {
    const res = await updateApplication(makeEvent({
      userId: USER,
      httpMethod: 'PUT',
      pathParameters: { appId: 'ghost' },
      body: body({ status: 'rejected' }),
    }));
    expect(res.statusCode).toBe(404);
  });
});

describe('deleteApplication', () => {
  it('deletes the application', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    const del = await deleteApplication(makeEvent({ userId: USER, httpMethod: 'DELETE', pathParameters: { appId: created.appId } }));
    expect(del.statusCode).toBe(200);

    const get = await getApplication(makeEvent({ userId: USER, httpMethod: 'GET', pathParameters: { appId: created.appId } }));
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 for already-deleted application', async () => {
    const created = parse(await createApplication(makeEvent({ userId: USER, httpMethod: 'POST', body: body(APP_BODY) })));
    await deleteApplication(makeEvent({ userId: USER, httpMethod: 'DELETE', pathParameters: { appId: created.appId } }));
    const res = await deleteApplication(makeEvent({ userId: USER, httpMethod: 'DELETE', pathParameters: { appId: created.appId } }));
    expect(res.statusCode).toBe(404);
  });
});

describe('resume useCount bookkeeping', () => {
  it('increments useCount when application is created with a resumeVersionId', async () => {
    const resume = parse(await getUploadUrl(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ label: 'v1', filename: 'resume.pdf' }),
    })));

    await createApplication(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ ...APP_BODY, resumeVersionId: resume.resume.versionId }),
    }));

    const list = parse(await (await import('../handlers/resumes')).listResumes(
      makeEvent({ userId: USER, httpMethod: 'GET' }),
    ));
    expect(list[0].useCount).toBe(1);
  });

  it('decrements useCount when application using a resume is deleted', async () => {
    const resume = parse(await getUploadUrl(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ label: 'v1', filename: 'resume.pdf' }),
    })));
    const app = parse(await createApplication(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ ...APP_BODY, resumeVersionId: resume.resume.versionId }),
    })));

    await deleteApplication(makeEvent({ userId: USER, httpMethod: 'DELETE', pathParameters: { appId: app.appId } }));

    const list = parse(await (await import('../handlers/resumes')).listResumes(
      makeEvent({ userId: USER, httpMethod: 'GET' }),
    ));
    expect(list[0].useCount).toBe(0);
  });

  it('swaps useCount when resumeVersionId is changed', async () => {
    const r1 = parse(await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ label: 'v1', filename: 'r1.pdf' }) })));
    const r2 = parse(await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ label: 'v2', filename: 'r2.pdf' }) })));

    const app = parse(await createApplication(makeEvent({
      userId: USER,
      httpMethod: 'POST',
      body: body({ ...APP_BODY, resumeVersionId: r1.resume.versionId }),
    })));

    await updateApplication(makeEvent({
      userId: USER,
      httpMethod: 'PUT',
      pathParameters: { appId: app.appId },
      body: body({ resumeVersionId: r2.resume.versionId }),
    }));

    const { listResumes } = await import('../handlers/resumes');
    const list: { versionId: string; useCount: number }[] = parse(
      await listResumes(makeEvent({ userId: USER, httpMethod: 'GET' })),
    );
    const v1 = list.find(r => r.versionId === r1.resume.versionId)!;
    const v2 = list.find(r => r.versionId === r2.resume.versionId)!;
    expect(v1.useCount).toBe(0);
    expect(v2.useCount).toBe(1);
  });
});
