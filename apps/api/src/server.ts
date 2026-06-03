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
import { listResumes, getUploadUrl, deleteResume } from './handlers/resumes';

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
app.delete('/resumes/:versionId', route(deleteResume));

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`API dev server running at http://localhost:${PORT}`);
  console.log(`DynamoDB endpoint: ${process.env.DYNAMODB_ENDPOINT ?? 'AWS (real)'}`);
});
