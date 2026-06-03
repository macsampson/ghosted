import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ok } from '../lib/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims ?? {};
  return ok({
    message: 'Auth is working',
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
  });
};
