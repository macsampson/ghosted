import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys, appendStatusHistory } from '../lib/dynamo';
import { ok, created, badRequest, notFound, serverError } from '../lib/response';
import { incrementUseCount, decrementUseCount } from './resumes';

const SalaryRangeSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  currency: z.string().default('USD'),
});

const ApplicationSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  jobUrl: z.string().url().optional().or(z.literal('')),
  status: z.enum(['applied', 'screening', 'online_assessment', 'phone_interview', 'technical_interview', 'onsite', 'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted']).default('applied'),
  appliedAt: z.string().datetime().optional(),
  salaryRange: SalaryRangeSchema.optional(),
  notes: z.string().optional(),
  resumeVersionId: z.string().optional(),
});

function sub(event: APIGatewayProxyEvent): string {
  return event.requestContext.authorizer?.claims?.sub as string;
}

export const listApplications = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'APP#' },
    }));
    const applications = (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest }) => rest);
    return ok(applications);
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const createApplication = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const body = JSON.parse(event.body ?? '{}');
    const parsed = ApplicationSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues.map(i => i.message).join(', '));

    const appId = crypto.randomUUID();
    const now = new Date().toISOString();
    const appliedAt = parsed.data.appliedAt ?? now;
    const { status } = parsed.data;

    // Last activity is the application itself — anchor it to appliedAt (not row-creation
    // time) so a backdated/retroactively-created app reads as stale when appliedAt is old.
    const lastActivityAt = appliedAt;
    const item = {
      ...keys.application(userId, appId),
      ...gsi1Keys(userId, status, appliedAt),
      ...gsi2Keys(userId, lastActivityAt),
      appId,
      ...parsed.data,
      appliedAt,
      lastActivityAt,
      createdAt: now,
      statusHistory: [{ status, at: appliedAt, source: 'created' as const }],
    };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    if (parsed.data.resumeVersionId) {
      await incrementUseCount(userId, parsed.data.resumeVersionId);
    }

    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...application } = item;
    return created(application);
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const getApplication = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const appId = event.pathParameters?.appId;
    if (!appId) return badRequest('Missing appId');

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(userId, appId),
    }));
    if (!result.Item) return notFound();

    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...application } = result.Item;
    return ok(application);
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

export const updateApplication = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const appId = event.pathParameters?.appId;
    if (!appId) return badRequest('Missing appId');

    const body = JSON.parse(event.body ?? '{}');
    const UpdateSchema = ApplicationSchema.partial().extend({
      salaryRange: SalaryRangeSchema.optional().nullable(),
    });
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues.map(i => i.message).join(', '));
    if (Object.keys(parsed.data).length === 0) return badRequest('No fields to update');

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...parsed.data };

    // Build UpdateExpression dynamically; null values become REMOVE expressions
    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        removeExpressions.push(`#${key}`);
        names[`#${key}`] = key;
      } else {
        const nameToken = `#${key}`;
        const valueToken = `:${key}`;
        setExpressions.push(`${nameToken} = ${valueToken}`);
        names[nameToken] = key;
        values[valueToken] = value;
      }
    }

    // Fetch current item when we need to diff GSI keys or resumeVersionId
    let currentItem: Record<string, unknown> | undefined;
    if (parsed.data.status || parsed.data.appliedAt || 'resumeVersionId' in parsed.data) {
      const current = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: keys.application(userId, appId),
      }));
      if (!current.Item) return notFound();
      currentItem = current.Item;
    }

    // Keep GSI keys in sync when status or appliedAt changes
    if (parsed.data.status || parsed.data.appliedAt) {
      const status = parsed.data.status ?? (currentItem!.status as string);
      const appliedAt = parsed.data.appliedAt ?? (currentItem!.appliedAt as string);
      const gsi1 = gsi1Keys(userId, status, appliedAt);
      setExpressions.push('#GSI1PK = :GSI1PK', '#GSI1SK = :GSI1SK');
      names['#GSI1PK'] = 'GSI1PK'; names['#GSI1SK'] = 'GSI1SK';
      values[':GSI1PK'] = gsi1.GSI1PK; values[':GSI1SK'] = gsi1.GSI1SK;
    }

    // Staleness resets only on a real status change — editing role/notes/etc. is
    // not activity. Bump lastActivityAt and the GSI2 stale key (and append to
    // statusHistory) only when the status actually moves to a new value.
    const statusChanged = !!(parsed.data.status && currentItem && parsed.data.status !== currentItem.status);
    if (statusChanged) {
      setExpressions.push('#lastActivityAt = :lastActivityAt');
      names['#lastActivityAt'] = 'lastActivityAt';
      values[':lastActivityAt'] = now;

      const gsi2 = gsi2Keys(userId, now);
      setExpressions.push('#GSI2PK = :GSI2PK', '#GSI2SK = :GSI2SK');
      names['#GSI2PK'] = 'GSI2PK'; names['#GSI2SK'] = 'GSI2SK';
      values[':GSI2PK'] = gsi2.GSI2PK; values[':GSI2SK'] = gsi2.GSI2SK;

      const append = appendStatusHistory({ status: parsed.data.status!, at: now, source: 'manual' });
      setExpressions.push(append.set);
      Object.assign(values, append.values);
    }

    const parts: string[] = [];
    if (setExpressions.length) parts.push(`SET ${setExpressions.join(', ')}`);
    if (removeExpressions.length) parts.push(`REMOVE ${removeExpressions.join(', ')}`);

    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.application(userId, appId),
      UpdateExpression: parts.join(' '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }));

    // Update resume useCount if resumeVersionId changed
    if ('resumeVersionId' in parsed.data && currentItem) {
      const oldId = currentItem.resumeVersionId as string | undefined;
      const newId = parsed.data.resumeVersionId;
      if (oldId !== newId) {
        if (oldId) await decrementUseCount(userId, oldId);
        if (newId) await incrementUseCount(userId, newId);
      }
    }

    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...application } = result.Attributes!;
    return ok(application);
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') return notFound();
    console.error(err);
    return serverError();
  }
};

// Lambda entry point — dispatches to the appropriate handler based on HTTP method + path
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const hasAppId = !!event.pathParameters?.appId;
  switch (event.httpMethod) {
    case 'GET':    return hasAppId ? getApplication(event) : listApplications(event);
    case 'POST':   return createApplication(event);
    case 'PUT':    return updateApplication(event);
    case 'DELETE': return deleteApplication(event);
    default:       return badRequest('Method not allowed');
  }
};

export const deleteApplication = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const appId = event.pathParameters?.appId;
    if (!appId) return badRequest('Missing appId');

    const existing = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.application(userId, appId),
    }));
    if (!existing.Item) return notFound();

    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: keys.application(userId, appId),
    }));

    if (existing.Item.resumeVersionId) {
      await decrementUseCount(userId, existing.Item.resumeVersionId as string);
    }

    return ok({ deleted: appId });
  } catch (err: any) {
    console.error(err);
    return serverError();
  }
};
