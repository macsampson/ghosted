import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { ok, created, badRequest, notFound, serverError, paymentRequired } from '../lib/response';
import { assertWithinCount, PlanLimitError, LIMITS } from '../lib/plan';

const isLocal = !!process.env.DYNAMODB_ENDPOINT;
const RESUME_BUCKET = process.env.RESUME_BUCKET ?? '';
// Local dev points S3_ENDPOINT at MinIO and exercises the real presigned-URL path.
// Tests run with DYNAMODB_ENDPOINT set but no S3_ENDPOINT → useMock keeps them off S3.
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const useMock = isLocal && !S3_ENDPOINT;

const s3 = new S3Client(
  S3_ENDPOINT
    ? {
        endpoint: S3_ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      }
    : {},
);

const CreateResumeSchema = z.object({
  label: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().default('application/pdf'),
});

function sub(event: APIGatewayProxyEvent): string {
  return event.requestContext.authorizer?.claims?.sub as string;
}

export const listResumes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'RESUME#' },
    }));
    const resumes = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
    return ok(resumes);
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const getUploadUrl = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const body = JSON.parse(event.body ?? '{}');
    const parsed = CreateResumeSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues.map(i => i.message).join(', '));

    await assertWithinCount(userId, 'RESUME#', LIMITS.resumes);

    const versionId = crypto.randomUUID();
    const s3Key = `${userId}/${versionId}/${parsed.data.filename}`;
    const now = new Date().toISOString();

    // In tests (no S3 endpoint), skip real S3 and return a mock response
    if (useMock) {
      const item = {
        ...keys.resume(userId, versionId),
        versionId,
        label: parsed.data.label,
        s3Key,
        uploadedAt: now,
        useCount: 0,
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      const { PK, SK, ...resume } = item;
      return created({ resume, uploadUrl: 'http://localhost:3001/mock-upload', fields: {} });
    }

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: RESUME_BUCKET, Key: s3Key, ContentType: parsed.data.contentType }),
      { expiresIn: 300 },
    );

    const item = {
      ...keys.resume(userId, versionId),
      versionId,
      label: parsed.data.label,
      s3Key,
      uploadedAt: now,
      useCount: 0,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    const { PK, SK, ...resume } = item;
    return created({ resume, uploadUrl, fields: {} });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return paymentRequired(`You've reached the free plan limit of ${err.limit} resume variant${err.limit === 1 ? '' : 's'}. Upgrade to Pro for unlimited.`, err.limit);
    }
    console.error(err);
    return serverError();
  }
};

export const getDownloadUrl = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const versionId = event.pathParameters?.versionId;
    if (!versionId) return badRequest('Missing versionId');

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': `RESUME#${versionId}` },
    }));
    if (!result.Items?.length) return notFound();

    const s3Key = result.Items[0].s3Key as string;

    if (useMock) {
      return ok({ url: 'http://localhost:3001/mock-download' });
    }

    const download = event.queryStringParameters?.download === 'true';
    const filename = s3Key.split('/').pop() ?? 'resume.pdf';
    const disposition = download ? `attachment; filename="${filename}"` : 'inline';

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: RESUME_BUCKET,
        Key: s3Key,
        ResponseContentDisposition: disposition,
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: 300 },
    );

    return ok({ url });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const deleteResume = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const versionId = event.pathParameters?.versionId;
    if (!versionId) return badRequest('Missing versionId');

    const existing = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `RESUME#${versionId}`,
      },
    }));
    if (!existing.Items?.length) return notFound();

    const s3Key = existing.Items[0].s3Key as string;

    if (!useMock) {
      await s3.send(new DeleteObjectCommand({ Bucket: RESUME_BUCKET, Key: s3Key }));
    }

    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: keys.resume(userId, versionId),
    }));

    return ok({ deleted: versionId });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const path = event.path;
  switch (event.httpMethod) {
    case 'GET':    return event.pathParameters?.versionId ? getDownloadUrl(event) : listResumes(event);
    case 'POST':   return getUploadUrl(event);
    case 'DELETE': return deleteResume(event);
    default:       return badRequest('Method not allowed');
  }
  void path;
};

export const incrementUseCount = async (userId: string, versionId: string) => {
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.resume(userId, versionId),
    UpdateExpression: 'ADD useCount :inc',
    ExpressionAttributeValues: { ':inc': 1 },
  }));
};

export const decrementUseCount = async (userId: string, versionId: string) => {
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.resume(userId, versionId),
    UpdateExpression: 'ADD useCount :dec',
    ExpressionAttributeValues: { ':dec': -1 },
  }));
};
