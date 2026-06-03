import type { APIGatewayProxyEvent } from 'aws-lambda';

export function makeEvent(
  overrides: Partial<APIGatewayProxyEvent> & { userId?: string },
): APIGatewayProxyEvent {
  const { userId = 'test-user', ...rest } = overrides;
  return {
    httpMethod: 'GET',
    path: '/',
    headers: {},
    multiValueHeaders: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      authorizer: {
        claims: { sub: userId, email: `${userId}@test.com` },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...rest,
  };
}

export function body(data: unknown) {
  return JSON.stringify(data);
}

export function parse(result: { body: string }) {
  return JSON.parse(result.body);
}
