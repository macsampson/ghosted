/**
 * Backfills `lastActivityAt` (and the GSI2 stale key) on applications that were
 * created with a backdated `appliedAt`.
 *
 * The old createApplication handler always stamped `lastActivityAt = now` (row
 * creation time) regardless of `appliedAt`, so a retroactively-created app never
 * went stale even when its application date was months old. The fix anchors a
 * new app's `lastActivityAt` to `appliedAt`; this script repairs existing rows.
 *
 * Safe targeting: at create time the old code set `lastActivityAt` and
 * `createdAt` from the *same* timestamp, so an app that has had no activity
 * since creation has `lastActivityAt === createdAt` exactly. Any real activity
 * (manual edit, status change, email match) bumps `lastActivityAt` to a later
 * time and breaks that equality. We therefore only touch rows that are BOTH:
 *
 *   1. untouched since creation   (lastActivityAt === createdAt), and
 *   2. backdated                  (appliedAt  <  createdAt)
 *
 * For those, lastActivityAt is reset to appliedAt. If the row is still indexed
 * in GSI2 (i.e. not auto-ghosted, which REMOVEs the GSI2 keys), its GSI2SK is
 * moved in lockstep so the daily stale digest sees it too. A condition guards
 * against re-runs and concurrent activity. Rows missing `createdAt` (too old to
 * reason about) are skipped and reported.
 *
 * Usage (local):  npx tsx scripts/backfill-last-activity.ts
 * Usage (prod):   TABLE_NAME=JobTracker AWS_REGION=us-east-1 \
 *                 DYNAMODB_ENDPOINT= npx tsx scripts/backfill-last-activity.ts
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
  let fixed = 0;
  let skippedNoCreatedAt = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':prefix': 'APP#' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of page.Items ?? []) {
      scanned++;
      const appliedAt = item.appliedAt as string | undefined;
      const createdAt = item.createdAt as string | undefined;
      const lastActivityAt = item.lastActivityAt as string | undefined;

      // Can't reason about rows without createdAt — leave them alone.
      if (!createdAt || !appliedAt || !lastActivityAt) {
        if (!createdAt) skippedNoCreatedAt++;
        continue;
      }

      // Only untouched-since-creation AND backdated rows are wrong.
      const untouched = lastActivityAt === createdAt;
      const backdated = appliedAt < createdAt;
      if (!untouched || !backdated) continue;

      const indexed = typeof item.GSI2SK === 'string';
      console.log(
        `${DRY_RUN ? '[dry-run] ' : ''}${item.PK}/${item.SK} ` +
          `lastActivityAt ${lastActivityAt} → ${appliedAt}${indexed ? ' (+GSI2SK)' : ''}`,
      );

      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: indexed
            ? 'SET lastActivityAt = :appliedAt, GSI2SK = :g2sk'
            : 'SET lastActivityAt = :appliedAt',
          // Idempotent / race-safe: only write if still the original createdAt value.
          ConditionExpression: 'lastActivityAt = :createdAt',
          ExpressionAttributeValues: {
            ':appliedAt': appliedAt,
            ':createdAt': createdAt,
            ...(indexed ? { ':g2sk': `LAST_ACTIVITY#${appliedAt}` } : {}),
          },
        }));
      }
      fixed++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\nScanned ${scanned} application(s); ${DRY_RUN ? 'would fix' : 'fixed'} ${fixed} backdated row(s).` +
      (skippedNoCreatedAt ? ` Skipped ${skippedNoCreatedAt} without createdAt.` : ''),
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
