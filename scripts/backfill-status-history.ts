/**
 * Backfills `statusHistory` on existing applications that predate transition
 * tracking. For each APP# item lacking the field, it synthesizes a minimal
 * history from the data we do have:
 *
 *   [{ applied @ appliedAt }]                         when status === 'applied'
 *   [{ applied @ appliedAt }, { <status> @ lastActivityAt }]   otherwise
 *
 * The funnel logic fills intermediate pipeline stages monotonically up to the
 * furthest stage in history, so a backfilled `onsite` app counts at every stage
 * from applied → onsite. Honest limitation: a backfilled *terminal* app
 * (rejected/withdrawn/ghosted) only records that it reached `applied` — we can't
 * know how far it actually got. Transitions recorded going forward fix this.
 * All synthesized events carry source: 'backfill' so the UI can flag estimates.
 *
 * Usage (local):  npx tsx scripts/backfill-status-history.ts
 * Usage (prod):   TABLE_NAME=JobTracker AWS_REGION=us-east-1 \
 *                 DYNAMODB_ENDPOINT= npx tsx scripts/backfill-status-history.ts
 * Add --dry-run to preview without writing.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const REGION = process.env.AWS_REGION ?? 'local';
const TABLE_NAME = process.env.TABLE_NAME ?? 'JobTracker';
const DRY_RUN = process.argv.includes('--dry-run');

const isLocal = ENDPOINT && REGION === 'local';
const client = new DynamoDBClient(
  isLocal
    ? { endpoint: ENDPOINT, region: 'local', credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' } }
    : ENDPOINT
      ? { endpoint: ENDPOINT, region: REGION }
      : { region: REGION },
);
const ddb = DynamoDBDocumentClient.from(client);

async function main() {
  let scanned = 0;
  let backfilled = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(SK, :prefix) AND attribute_not_exists(statusHistory)',
      ExpressionAttributeValues: { ':prefix': 'APP#' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of page.Items ?? []) {
      scanned++;
      const status = item.status as string;
      const appliedAt = (item.appliedAt as string) ?? (item.createdAt as string);
      const lastActivityAt = (item.lastActivityAt as string) ?? appliedAt;

      const history =
        status === 'applied'
          ? [{ status: 'applied', at: appliedAt, source: 'backfill' }]
          : [
              { status: 'applied', at: appliedAt, source: 'backfill' },
              { status, at: lastActivityAt, source: 'backfill' },
            ];

      console.log(`${DRY_RUN ? '[dry-run] ' : ''}${item.PK}/${item.SK} → ${history.map(h => h.status).join(' → ')}`);

      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: item.PK, SK: item.SK },
          // Guard against races / re-runs: only write if still absent.
          UpdateExpression: 'SET statusHistory = :h',
          ConditionExpression: 'attribute_not_exists(statusHistory)',
          ExpressionAttributeValues: { ':h': history },
        }));
      }
      backfilled++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`\nScanned ${scanned} application(s) without history; ${DRY_RUN ? 'would backfill' : 'backfilled'} ${backfilled}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
