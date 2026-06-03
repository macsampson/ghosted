import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const isLocal = !!process.env.DYNAMODB_ENDPOINT;

const client = new DynamoDBClient(
  isLocal
    ? {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        region: 'local',
        credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
      }
    : {},
);
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = process.env.TABLE_NAME!;

export const keys = {
  user: (sub: string) => ({ PK: `USER#${sub}`, SK: 'PROFILE' }),
  application: (sub: string, appId: string) => ({ PK: `USER#${sub}`, SK: `APP#${appId}` }),
  resume: (sub: string, versionId: string) => ({ PK: `USER#${sub}`, SK: `RESUME#${versionId}` }),
  email: (sub: string, emailId: string) => ({ PK: `USER#${sub}`, SK: `EMAIL#${emailId}` }),
};

export const gsi1Keys = (sub: string, status: string, appliedAt: string) => ({
  GSI1PK: `USER#${sub}`,
  GSI1SK: `STATUS#${status}#${appliedAt}`,
});

export const gsi2Keys = (sub: string, lastActivityAt: string) => ({
  GSI2PK: `USER#${sub}`,
  GSI2SK: `LAST_ACTIVITY#${lastActivityAt}`,
});
