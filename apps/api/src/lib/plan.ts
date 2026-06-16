import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from './dynamo';

/**
 * Free-tier limits. Single source of truth — the frontend mirrors these in
 * `apps/web/src/lib/pricing.ts`. Pro is unlimited on all of them.
 */
export const LIMITS = {
  applications: 25,
  resumes: 1,
  classificationsPerMonth: 20,
} as const;

export type Plan = 'free' | 'pro';

/** Stripe subscription statuses we treat as an active Pro entitlement. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Limit enforcement is opt-in via env so the existing test suite (which creates
 * many apps/resumes for a profile-less user) and day-to-day local dev stay
 * unlimited. Production Lambdas set PLAN_LIMITS_ENABLED=true via CDK; the new
 * gating tests set it explicitly before importing the handler under test.
 */
export function enforcementOn(): boolean {
  return process.env.PLAN_LIMITS_ENABLED === 'true';
}

/** Thrown by the assert helpers when a free user is over a limit. */
export class PlanLimitError extends Error {
  constructor(public readonly limit: number, message: string) {
    super(message);
    this.name = 'PlanLimitError';
  }
}

interface ProfileItem {
  plan?: Plan;
  subscriptionStatus?: string;
  classifyUsage?: { month: string; count: number };
}

async function getProfileItem(userId: string): Promise<ProfileItem | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.user(userId) }));
  return res.Item as ProfileItem | undefined;
}

/** A user is Pro only with an explicit `plan: 'pro'` and an active subscription. */
export function planFromProfile(item: ProfileItem | undefined): Plan {
  if (item?.plan === 'pro' && (!item.subscriptionStatus || ACTIVE_STATUSES.has(item.subscriptionStatus))) {
    return 'pro';
  }
  return 'free';
}

export async function getPlan(userId: string): Promise<Plan> {
  return planFromProfile(await getProfileItem(userId));
}

/** Current month key, e.g. "2026-06", used to scope the classification meter. */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Counts existing items under a given SK prefix and throws PlanLimitError when a
 * free user is at or above `limit`. No-op when enforcement is off or the user is
 * Pro. Counts only — does not write.
 */
export async function assertWithinCount(userId: string, skPrefix: string, limit: number): Promise<void> {
  if (!enforcementOn()) return;
  if ((await getPlan(userId)) === 'pro') return;

  const res = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': skPrefix },
    Select: 'COUNT',
  }));
  if ((res.Count ?? 0) >= limit) {
    throw new PlanLimitError(limit, `Free plan limit of ${limit} reached`);
  }
}

/**
 * Meters AI email classifications for free users. Reads the profile's monthly
 * counter (resetting it on month rollover), and only increments — and reports
 * `allowed` — when the user is under the cap. Pro users and disabled
 * enforcement always return `{ allowed: true }` without writing.
 */
export async function meterClassification(userId: string, now = new Date()): Promise<{ allowed: boolean }> {
  if (!enforcementOn()) return { allowed: true };

  const item = await getProfileItem(userId);
  if (planFromProfile(item) === 'pro') return { allowed: true };

  const month = currentMonth(now);
  const sameMonth = item?.classifyUsage?.month === month;
  const used = sameMonth ? item!.classifyUsage!.count : 0;
  if (used >= LIMITS.classificationsPerMonth) return { allowed: false };

  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.user(userId),
    UpdateExpression: 'SET classifyUsage = :u',
    ExpressionAttributeValues: { ':u': { month, count: used + 1 } },
  }));
  return { allowed: true };
}
