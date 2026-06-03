import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';

const TABLE = 'JobTracker-test';

const client = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'local',
  credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
});

export async function setup() {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  if (TableNames?.includes(TABLE)) {
    await client.send(new DeleteTableCommand({ TableName: TABLE }));
  }
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
}

export async function teardown() {
  await client.send(new DeleteTableCommand({ TableName: TABLE })).catch(() => {});
}
