import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Stripe from 'stripe';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { ok, badRequest, serverError } from '../lib/response';
import { getSecrets } from '../lib/secrets';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// The instance type. The package's CJS typings don't surface the resource-type
// namespace on the default import, so we use minimal structural types for the
// webhook payloads we touch (id/status/period/metadata) below.
type StripeClient = Stripe.Stripe;
interface SubscriptionLike {
  id: string;
  status: string;
  current_period_end: number;
  metadata?: Record<string, string> | null;
}

// Lazily build the Stripe client from secrets once, reusing across warm invokes.
let stripePromise: Promise<StripeClient> | undefined;
function getStripe(): Promise<StripeClient> {
  if (!stripePromise) {
    stripePromise = getSecrets().then(({ stripeSecretKey }) => new Stripe(stripeSecretKey));
  }
  return stripePromise;
}

function sub(event: APIGatewayProxyEvent): string {
  return event.requestContext.authorizer?.claims?.sub as string;
}

function email(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext.authorizer?.claims?.email as string | undefined;
}

async function getProfileItem(userId: string): Promise<Record<string, unknown> | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.user(userId) }));
  return res.Item;
}

/** Returns the user's Stripe customer id, creating + persisting one if absent. */
async function ensureCustomer(stripe: StripeClient, userId: string, userEmail?: string): Promise<string> {
  const item = await getProfileItem(userId);
  const existing = item?.stripeCustomerId as string | undefined;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { userId },
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.user(userId),
    UpdateExpression: 'SET stripeCustomerId = :c',
    ExpressionAttributeValues: { ':c': customer.id },
  }));
  return customer.id;
}

// POST /billing/checkout (authenticated) — start a Stripe Checkout subscription.
export const createCheckout = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const { stripePriceId } = await getSecrets();
    const stripe = await getStripe();
    const customerId = await ensureCustomer(stripe, userId, email(event));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      subscription_data: { metadata: { userId } },
      success_url: `${FRONTEND_URL}/settings?billing=success`,
      cancel_url: `${FRONTEND_URL}/pricing?billing=cancel`,
    });

    return ok({ url: session.url });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

// POST /billing/portal (authenticated) — manage/cancel the subscription.
export const createPortal = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = sub(event);
    const item = await getProfileItem(userId);
    const customerId = item?.stripeCustomerId as string | undefined;
    if (!customerId) return badRequest('No billing account found');

    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND_URL}/settings`,
    });
    return ok({ url: session.url });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

async function setPlan(
  userId: string,
  plan: 'free' | 'pro',
  fields: { subscriptionStatus?: string; stripeSubscriptionId?: string; currentPeriodEnd?: number } = {},
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: keys.user(userId),
    UpdateExpression: 'SET #plan = :plan, subscriptionStatus = :status, stripeSubscriptionId = :subId, currentPeriodEnd = :cpe',
    ExpressionAttributeNames: { '#plan': 'plan' },
    ExpressionAttributeValues: {
      ':plan': plan,
      ':status': fields.subscriptionStatus ?? null,
      ':subId': fields.stripeSubscriptionId ?? null,
      ':cpe': fields.currentPeriodEnd ?? null,
    },
  }));
}

/** Apply a Stripe subscription's state to the user's profile. */
export async function applySubscription(userId: string, subscription: SubscriptionLike): Promise<void> {
  const status = subscription.status;
  const active = status === 'active' || status === 'trialing' || status === 'past_due';
  await setPlan(userId, active ? 'pro' : 'free', {
    subscriptionStatus: status,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end,
  });
}

// POST /billing/webhook (public, raw body) — Stripe event sink.
export const webhook = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const { stripeWebhookSecret } = await getSecrets();
    const stripe = await getStripe();
    const sig = event.headers['stripe-signature'] ?? event.headers['Stripe-Signature'];
    if (!sig) return badRequest('Missing signature');

    let stripeEvent: ReturnType<typeof stripe.webhooks.constructEvent>;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body ?? '', sig, stripeWebhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed', err);
      return badRequest('Invalid signature');
    }

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as { client_reference_id: string | null; subscription: string | null };
        const userId = session.client_reference_id;
        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription) as unknown as SubscriptionLike;
          await applySubscription(userId, subscription);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object as unknown as SubscriptionLike;
        const userId = subscription.metadata?.userId;
        if (userId) {
          if (stripeEvent.type === 'customer.subscription.deleted') {
            await setPlan(userId, 'free', { subscriptionStatus: 'canceled' });
          } else {
            await applySubscription(userId, subscription);
          }
        }
        break;
      }
      default:
        break;
    }

    return ok({ received: true });
  } catch (err) {
    console.error(err);
    return serverError();
  }
};

// Lambda entry point.
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const path = event.path;
  if (path.endsWith('/webhook')) return webhook(event);
  if (path.endsWith('/checkout')) return createCheckout(event);
  if (path.endsWith('/portal')) return createPortal(event);
  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
};
