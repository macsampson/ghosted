import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { ok, created, badRequest, notFound, serverError } from '../lib/response';

const isLocal = !!process.env.DYNAMODB_ENDPOINT;
const RESUME_BUCKET = process.env.RESUME_BUCKET ?? '';

const s3 = new S3Client(isLocal ? { region: 'us-east-1' } : {});

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

    const versionId = crypto.randomUUID();
    const s3Key = `${userId}/${versionId}/${parsed.data.filename}`;
    const now = new Date().toISOString();

    // In local dev, skip real S3 and return a mock response
    if (isLocal) {
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

    if (!isLocal) {
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
    case 'GET':    return listResumes(event);
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
