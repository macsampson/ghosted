/**
 * Migrates legacy `appliedAt` values that were stored at **midnight UTC** to **noon
 * UTC**, so they render to the correct calendar day when the UI formats dates in the
 * user's local timezone.
 *
 * Background: form-entered application dates used to be stored as
 * `new Date("YYYY-MM-DD").toISOString()` → `...T00:00:00.000Z`. The UI now formats
 * `appliedAt` in local time; a midnight-UTC value renders as the *previous* day for
 * users behind UTC. Anchoring calendar dates at noon UTC keeps them on the same day
 * in every realistic timezone. New writes already use noon UTC — this fixes old rows.
 *
 * Scope: only APP# items whose `appliedAt` ends in `T00:00:00.000Z` (legacy form-
 * entered calendar dates). Auto-created apps store the email's real received instant,
 * which is virtually never exactly midnight, so they are left untouched. `GSI1SK`
 * embeds `appliedAt` (`STATUS#<status>#<appliedAt>`) and is updated in lockstep.
 * `lastActivityAt`/`statusHistory` are intentionally not touched — a 12h shift of the
 * applied anchor does not affect whole-day staleness or funnel metrics.
 *
 * Usage (local):  npx tsx scripts/migrate-applied-at-noon.ts
 * Usage (prod):   TABLE_NAME=JobTracker AWS_REGION=us-east-1 DYNAMODB_ENDPOINT= \
 *                 npx tsx scripts/migrate-applied-at-noon.ts
 * Add --dry-run to preview without writing.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const REGION = process.env.AWS_REGION ?? 'local';
const TABLE_NAME = process.env.TABLE_NAME ?? 'JobTracker';
const DRY_RUN = process.argv.includes('--dry-run');

const MIDNIGHT_SUFFIX = 'T00:00:00.000Z';
const NOON_SUFFIX = 'T12:00:00.000Z';

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
  let migrated = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(SK, :appPrefix)',
      ExpressionAttributeValues: { ':appPrefix': 'APP#' },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of res.Items ?? []) {
      scanned++;
      const appliedAt = item.appliedAt as string | undefined;
      if (!appliedAt || !appliedAt.endsWith(MIDNIGHT_SUFFIX)) continue;

      const newAppliedAt = appliedAt.slice(0, -MIDNIGHT_SUFFIX.length) + NOON_SUFFIX;
      const status = item.status as string;
      const newGsi1sk = `STATUS#${status}#${newAppliedAt}`;
      migrated++;

      console.log(
        `${DRY_RUN ? '[dry-run] ' : ''}${item.PK} ${item.SK}: ${appliedAt} → ${newAppliedAt}`,
      );
      if (DRY_RUN) continue;

      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET appliedAt = :a, GSI1SK = :g',
        ExpressionAttributeValues: { ':a': newAppliedAt, ':g': newGsi1sk },
      }));
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${DRY_RUN ? '[dry-run] ' : ''}Scanned ${scanned} APP# items; ` +
    `${migrated} midnight-UTC appliedAt value(s) ${DRY_RUN ? 'would be' : 'were'} shifted to noon UTC.`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
