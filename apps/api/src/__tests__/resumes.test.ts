import { describe, it, expect, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import { getUploadUrl, getDownloadUrl, listResumes, deleteResume } from '../handlers/resumes';
import { makeEvent, body, parse } from './helpers';

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

const USER = 'user-resumes-test';

const RESUME_BODY = { label: 'SWE v1', filename: 'swe-v1.pdf', contentType: 'application/pdf' };

beforeEach(clearTable);

describe('getUploadUrl', () => {
  it('returns 201 with resume metadata and mock upload URL', async () => {
    const res = await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body(RESUME_BODY) }));
    expect(res.statusCode).toBe(201);
    const { resume, uploadUrl } = parse(res);
    expect(resume.versionId).toBeTruthy();
    expect(resume.label).toBe('SWE v1');
    expect(resume.s3Key).toContain('swe-v1.pdf');
    expect(resume.useCount).toBe(0);
    expect(uploadUrl).toBeTruthy();
  });

  it('rejects missing label', async () => {
    const res = await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ filename: 'swe.pdf' }) }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing filename', async () => {
    const res = await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body({ label: 'SWE v1' }) }));
    expect(res.statusCode).toBe(400);
  });
});

describe('listResumes', () => {
  it('returns empty array when no resumes', async () => {
    const res = await listResumes(makeEvent({ userId: USER }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual([]);
  });

  it('returns uploaded resumes', async () => {
    await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body(RESUME_BODY) }));
    const res = await listResumes(makeEvent({ userId: USER }));
    expect(res.statusCode).toBe(200);
    const list = parse(res);
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('SWE v1');
  });

  it('does not return other users resumes', async () => {
    await getUploadUrl(makeEvent({ userId: 'other-user', httpMethod: 'POST', body: body(RESUME_BODY) }));
    const res = await listResumes(makeEvent({ userId: USER }));
    expect(parse(res)).toHaveLength(0);
  });
});

describe('getDownloadUrl', () => {
  it('returns 200 with a URL for an existing resume', async () => {
    const created = await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body(RESUME_BODY) }));
    const { resume } = parse(created);

    const res = await getDownloadUrl(makeEvent({
      userId: USER,
      httpMethod: 'GET',
      pathParameters: { versionId: resume.versionId },
    }));
    expect(res.statusCode).toBe(200);
    const { url } = parse(res);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent resume', async () => {
    const res = await getDownloadUrl(makeEvent({
      userId: USER,
      httpMethod: 'GET',
      pathParameters: { versionId: 'does-not-exist' },
    }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when versionId is missing', async () => {
    const res = await getDownloadUrl(makeEvent({ userId: USER, httpMethod: 'GET' }));
    expect(res.statusCode).toBe(400);
  });

  it('does not return URL for another users resume', async () => {
    const created = await getUploadUrl(makeEvent({ userId: 'other-user', httpMethod: 'POST', body: body(RESUME_BODY) }));
    const { resume } = parse(created);

    const res = await getDownloadUrl(makeEvent({
      userId: USER,
      httpMethod: 'GET',
      pathParameters: { versionId: resume.versionId },
    }));
    expect(res.statusCode).toBe(404);
  });
});

describe('deleteResume', () => {
  it('deletes an existing resume', async () => {
    const created = await getUploadUrl(makeEvent({ userId: USER, httpMethod: 'POST', body: body(RESUME_BODY) }));
    const { resume } = parse(created);

    const res = await deleteResume(makeEvent({
      userId: USER,
      httpMethod: 'DELETE',
      pathParameters: { versionId: resume.versionId },
    }));
    expect(res.statusCode).toBe(200);

    const list = await listResumes(makeEvent({ userId: USER }));
    expect(parse(list)).toHaveLength(0);
  });

  it('returns 404 when deleting non-existent resume', async () => {
    const res = await deleteResume(makeEvent({
      userId: USER,
      httpMethod: 'DELETE',
      pathParameters: { versionId: 'ghost-id' },
    }));
    expect(res.statusCode).toBe(404);
  });
});
