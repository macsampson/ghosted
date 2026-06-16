import type { APIGatewayProxyResult } from 'aws-lambda';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export const ok = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers,
  body: JSON.stringify(body),
});

export const created = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 201,
  headers,
  body: JSON.stringify(body),
});

export const badRequest = (message: string): APIGatewayProxyResult => ({
  statusCode: 400,
  headers,
  body: JSON.stringify({ error: message }),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResult => ({
  statusCode: 404,
  headers,
  body: JSON.stringify({ error: message }),
});

// 402 — used when a free-plan user hits a usage limit. The body carries a
// machine-readable `code` + `limit` so the frontend can show an upgrade nudge.
export const paymentRequired = (message: string, limit?: number): APIGatewayProxyResult => ({
  statusCode: 402,
  headers,
  body: JSON.stringify({ error: message, code: 'plan_limit', limit }),
});

export const serverError = (message = 'Internal server error'): APIGatewayProxyResult => ({
  statusCode: 500,
  headers,
  body: JSON.stringify({ error: message }),
});
