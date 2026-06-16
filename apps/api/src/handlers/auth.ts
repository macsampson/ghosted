import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { ok, serverError } from '../lib/response';
import { encrypt } from '../lib/crypto';
import { getSecrets } from '../lib/secrets';
import { planFromProfile, currentMonth, LIMITS } from '../lib/plan';

const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI ?? 'http://localhost:3001/auth/gmail/callback';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

function sub(event: APIGatewayProxyEvent): string {
  return event.requestContext.authorizer?.claims?.sub as string;
}

function redirect(location: string): APIGatewayProxyResult {
  return {
    statusCode: 302,
    headers: { Location: location, 'Access-Control-Allow-Origin': '*' },
    body: '',
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const path = event.path;
  if (path === '/profile') return getProfile(event);
  if (path.endsWith('/start')) return startGmailAuth(event);
  if (path.endsWith('/callback')) return gmailCallback(event);
  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
};

// GET /profile
export const getProfile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const [profileRes, appCount, resumeCount] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.user(userId) })),
      countItems(userId, 'APP#'),
      countItems(userId, 'RESUME#'),
    ]);
    const item = profileRes.Item;
    const plan = planFromProfile(item);
    const usage = item?.classifyUsage as { month: string; count: number } | undefined;
    const classifications = usage?.month === currentMonth() ? usage.count : 0;

    return ok({
      sub: userId,
      email: event.requestContext.authorizer?.claims?.email as string | undefined,
      gmailConnected: !!item?.gmailConnected,
      plan,
      subscriptionStatus: (item?.subscriptionStatus as string | undefined) ?? null,
      currentPeriodEnd: (item?.currentPeriodEnd as number | undefined) ?? null,
      usage: {
        applications: appCount,
        resumes: resumeCount,
        classifications,
      },
      limits: LIMITS,
    });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

async function countItems(userId: string, skPrefix: string): Promise<number> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': skPrefix },
    Select: 'COUNT',
  }));
  return res.Count ?? 0;
}

// POST /auth/gmail/start (authenticated)
// Local dev: writes a mock token directly and returns { connected: true }.
// Prod: stores OAuth state in DDB and returns { authUrl } for the browser to redirect to.
export const startGmailAuth = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);

    const { gmailClientId, gmailClientSecret } = await getSecrets();
    if (!gmailClientId || !gmailClientSecret) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keys.user(userId),
        UpdateExpression: 'SET gmailRefreshToken = :token, gmailConnected = :yes',
        ExpressionAttributeValues: { ':token': await encrypt('mock-refresh-token'), ':yes': true },
      }));
      return ok({ connected: true, mock: true });
    }

    const state = crypto.randomUUID();
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'OAUTH_STATE',
        SK: state,
        sub: userId,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      },
    }));

    const params = new URLSearchParams({
      client_id: gmailClientId,
      redirect_uri: GMAIL_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return ok({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

// GET /auth/gmail/callback (unauthenticated — Google redirects here)
export const gmailCallback = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const { code, state, error } = event.queryStringParameters ?? {};

    if (error) {
      return redirect(`${FRONTEND_URL}/settings?error=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return redirect(`${FRONTEND_URL}/settings?error=missing_params`);
    }

    const stateRecord = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'OAUTH_STATE', SK: state },
    }));
    if (!stateRecord.Item) {
      return redirect(`${FRONTEND_URL}/settings?error=invalid_state`);
    }
    const userId = stateRecord.Item.sub as string;

    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'OAUTH_STATE', SK: state },
    }));

    const { gmailClientId, gmailClientSecret } = await getSecrets();
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: gmailClientId,
        client_secret: gmailClientSecret,
        redirect_uri: GMAIL_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json() as { refresh_token?: string; error?: string };

    if (!tokens.refresh_token) {
      console.error('No refresh token in response:', tokens);
      return redirect(`${FRONTEND_URL}/settings?error=no_refresh_token`);
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.user(userId),
      UpdateExpression: 'SET gmailRefreshToken = :token, gmailConnected = :yes',
      ExpressionAttributeValues: { ':token': await encrypt(tokens.refresh_token), ':yes': true },
    }));

    return redirect(`${FRONTEND_URL}/settings?connected=true`);
  } catch (err) {
    console.error(err);
    return redirect(`${FRONTEND_URL}/settings?error=server_error`);
  }
};
