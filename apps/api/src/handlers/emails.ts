import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys, gsi1Keys, gsi2Keys, appendStatusHistory } from '../lib/dynamo';
import { ok, badRequest, notFound, serverError } from '../lib/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, path } = event;
  if (httpMethod === 'GET' && path === '/emails') return listEmails(event);
  if (httpMethod === 'POST' && path.endsWith('/confirm')) return confirmEmail(event);
  if (httpMethod === 'POST' && path.endsWith('/dismiss')) return dismissEmail(event);
  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
};

function sub(event: APIGatewayProxyEvent): string {
  return event.requestContext.authorizer?.claims?.sub as string;
}

// GET /emails?needsReview=true
export const listEmails = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const filterNeedsReview = event.queryStringParameters?.needsReview === 'true';

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'EMAIL#' },
    }));

    let emails = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
    if (filterNeedsReview) {
      emails = emails.filter(e => e.needsReview === true);
    }
    return ok(emails);
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

// POST /emails/:emailId/confirm — apply the suggested status to the linked application
export const confirmEmail = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const emailId = event.pathParameters?.emailId;
    if (!emailId) return badRequest('Missing emailId');

    const emailResult = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.email(userId, emailId),
    }));
    if (!emailResult.Item) return notFound('Email not found');

    const email = emailResult.Item;

    if (email.applicationId && email.suggestedStatus) {
      const appResult = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: keys.application(userId, email.applicationId as string),
      }));
      if (appResult.Item) {
        const now = new Date().toISOString();
        const appliedAt = appResult.Item.appliedAt as string;
        const gsi1 = gsi1Keys(userId, email.suggestedStatus as string, appliedAt);
        const gsi2 = gsi2Keys(userId, now);
        const setClauses = [
          '#status = :status',
          'lastActivityAt = :now',
          'GSI1PK = :gsi1pk',
          'GSI1SK = :gsi1sk',
          'GSI2PK = :gsi2pk',
          'GSI2SK = :gsi2sk',
        ];
        const values: Record<string, unknown> = {
          ':status': email.suggestedStatus,
          ':now': now,
          ':gsi1pk': gsi1.GSI1PK,
          ':gsi1sk': gsi1.GSI1SK,
          ':gsi2pk': gsi2.GSI2PK,
          ':gsi2sk': gsi2.GSI2SK,
        };
        // Record the transition only if confirming actually changes the status.
        if (email.suggestedStatus !== appResult.Item.status) {
          const append = appendStatusHistory({ status: email.suggestedStatus as string, at: now, source: 'email_confirmed' });
          setClauses.push(append.set);
          Object.assign(values, append.values);
        }
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: keys.application(userId, email.applicationId as string),
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: values,
        }));
      }
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.email(userId, emailId),
      UpdateExpression: 'SET needsReview = :no, reviewed = :yes, reviewedAt = :now',
      ExpressionAttributeValues: { ':no': false, ':yes': true, ':now': new Date().toISOString() },
    }));

    return ok({ confirmed: true });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

// POST /emails/:emailId/dismiss — mark reviewed, take no action
export const dismissEmail = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const emailId = event.pathParameters?.emailId;
    if (!emailId) return badRequest('Missing emailId');

    const existing = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.email(userId, emailId),
    }));
    if (!existing.Item) return notFound('Email not found');

    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.email(userId, emailId),
      UpdateExpression: 'SET needsReview = :no, reviewed = :yes, reviewedAt = :now',
      ExpressionAttributeValues: { ':no': false, ':yes': true, ':now': new Date().toISOString() },
    }));

    return ok({ dismissed: true });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};
