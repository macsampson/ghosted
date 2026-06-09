/**
 * Creates the JobTracker table in DynamoDB Local.
 * Run once after `docker compose up -d`: npm run db:setup
 */
import { DynamoDBClient, CreateTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const client = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'local',
  credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
});

const RESUME_BUCKET = 'ghosted-resumes';

const s3 = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});

async function setupBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: RESUME_BUCKET }));
    console.log(`${RESUME_BUCKET} bucket already exists`);
    return;
  } catch {
    // not found — create it below
  }
  await s3.send(new CreateBucketCommand({ Bucket: RESUME_BUCKET }));
  console.log(`Created ${RESUME_BUCKET} bucket`);
}

async function main() {
  await setupBucket();

  const { TableNames } = await client.send(new ListTablesCommand({}));
  if (TableNames?.includes('JobTracker')) {
    console.log('JobTracker table already exists');
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: 'JobTracker',
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

  console.log('Created JobTracker table');
}

main().catch(console.error);
