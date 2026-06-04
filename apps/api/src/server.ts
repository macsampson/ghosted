import express from 'express';
import cors from 'cors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Request, Response } from 'express';

import { handler as helloHandler } from './handlers/hello';
import {
  listApplications,
  createApplication,
  getApplication,
  updateApplication,
  deleteApplication,
} from './handlers/applications';
import { listResumes, getUploadUrl, getDownloadUrl, deleteResume } from './handlers/resumes';
import { getProfile, startGmailAuth, gmailCallback } from './handlers/auth';
import { listEmails, confirmEmail, dismissEmail } from './handlers/emails';
import { runPipelineForUser } from './handlers/email-poller';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from './lib/dynamo';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Inject a fake Cognito user for every request in local dev.
// All Lambda handlers read from event.requestContext.authorizer.claims.
const DEV_USER = {
  sub: 'dev-user-local-123',
  email: 'dev@ghosted.local',
  name: 'Dev User',
};

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

function route(handler: Handler) {
  return async (req: Request, res: Response) => {
    const event = {
      httpMethod: req.method,
      path: req.path,
      headers: req.headers as Record<string, string>,
      body: req.body ? JSON.stringify(req.body) : null,
      pathParameters: req.params as Record<string, string>,
      queryStringParameters: req.query as Record<string, string>,
      requestContext: {
        authorizer: { claims: DEV_USER },
      },
    } as unknown as APIGatewayProxyEvent;

    const result = await handler(event);
    res.status(result.statusCode).set((result.headers as Record<string, string>) ?? {}).send(result.body);
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/hello', route(helloHandler));

app.get('/applications', route(listApplications));
app.post('/applications', route(createApplication));
app.get('/applications/:appId', route(getApplication));
app.put('/applications/:appId', route(updateApplication));
app.delete('/applications/:appId', route(deleteApplication));

app.get('/resumes', route(listResumes));
app.post('/resumes/upload-url', route(getUploadUrl));
app.get('/resumes/:versionId/url', route(getDownloadUrl));
app.delete('/resumes/:versionId', route(deleteResume));

app.get('/profile', route(getProfile));
app.post('/auth/gmail/start', route(startGmailAuth));
app.get('/auth/gmail/callback', route(gmailCallback));

app.get('/emails', route(listEmails));
app.post('/emails/:emailId/confirm', route(confirmEmail));
app.post('/emails/:emailId/dismiss', route(dismissEmail));

// ── Debug (local dev only) ────────────────────────────────────────────────────

app.post('/debug/poll-emails', async (_req, res) => {
  const userId = DEV_USER.sub;
  const profile = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: keys.user(userId),
    ProjectionExpression: 'gmailRefreshToken',
  }));
  if (!profile.Item?.gmailRefreshToken) {
    res.status(400).json({ error: 'Gmail not connected — visit /settings to connect' });
    return;
  }
  const result = await runPipelineForUser(userId, profile.Item.gmailRefreshToken as string);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`API dev server running at http://localhost:${PORT}`);
  console.log(`DynamoDB endpoint: ${process.env.DYNAMODB_ENDPOINT ?? 'AWS (real)'}`);
});
