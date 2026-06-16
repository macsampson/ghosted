import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';
import { makeEvent, parse } from './helpers';

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  subRetrieve: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class {
    customers = { create: stripeMock.customersCreate };
    checkout = { sessions: { create: stripeMock.checkoutCreate } };
    billingPortal = { sessions: { create: stripeMock.portalCreate } };
    subscriptions = { retrieve: stripeMock.subRetrieve };
    webhooks = { constructEvent: stripeMock.constructEvent };
  },
}));

// Imported after the mock is registered.
const { createCheckout, createPortal, webhook } = await import('../handlers/billing');

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

async function getProfileItem(userId: string) {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.user(userId) }));
  return res.Item;
}

beforeEach(async () => {
  await clearTable();
  vi.clearAllMocks();
});

describe('createCheckout', () => {
  it('creates a Stripe customer, persists it, and returns the session url', async () => {
    stripeMock.customersCreate.mockResolvedValue({ id: 'cus_123' });
    stripeMock.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/s/1' });

    const res = await createCheckout(makeEvent({ userId: 'u1', httpMethod: 'POST' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).url).toBe('https://checkout.stripe.test/s/1');

    const profile = await getProfileItem('u1');
    expect(profile?.stripeCustomerId).toBe('cus_123');

    // client_reference_id carries the user id so the webhook can resolve the user.
    expect(stripeMock.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123', client_reference_id: 'u1', mode: 'subscription' }),
    );
  });

  it('reuses an existing Stripe customer', async () => {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...keys.user('u2'), stripeCustomerId: 'cus_existing' },
    }));
    stripeMock.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/s/2' });

    const res = await createCheckout(makeEvent({ userId: 'u2', httpMethod: 'POST' }));
    expect(res.statusCode).toBe(200);
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    );
  });
});

describe('createPortal', () => {
  it('returns a portal url for a user with a customer id', async () => {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...keys.user('u3'), stripeCustomerId: 'cus_3' },
    }));
    stripeMock.portalCreate.mockResolvedValue({ url: 'https://portal.stripe.test/p/3' });

    const res = await createPortal(makeEvent({ userId: 'u3', httpMethod: 'POST' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).url).toBe('https://portal.stripe.test/p/3');
  });

  it('400s when the user has no billing account', async () => {
    const res = await createPortal(makeEvent({ userId: 'nobody', httpMethod: 'POST' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('webhook', () => {
  function webhookEvent(bodyObj: unknown) {
    return makeEvent({
      httpMethod: 'POST',
      path: '/billing/webhook',
      headers: { 'stripe-signature': 'sig_test' },
      body: JSON.stringify(bodyObj),
    });
  }

  it('upgrades the user to pro on checkout.session.completed', async () => {
    stripeMock.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'u4', subscription: 'sub_4' } },
    });
    stripeMock.subRetrieve.mockResolvedValue({
      id: 'sub_4',
      status: 'active',
      current_period_end: 1800000000,
      metadata: { userId: 'u4' },
    });

    const res = await webhook(webhookEvent({}));
    expect(res.statusCode).toBe(200);

    const profile = await getProfileItem('u4');
    expect(profile?.plan).toBe('pro');
    expect(profile?.subscriptionStatus).toBe('active');
    expect(profile?.stripeSubscriptionId).toBe('sub_4');
  });

  it('downgrades the user to free on customer.subscription.deleted', async () => {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...keys.user('u5'), plan: 'pro', subscriptionStatus: 'active' },
    }));
    stripeMock.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_5', status: 'canceled', metadata: { userId: 'u5' } } },
    });

    const res = await webhook(webhookEvent({}));
    expect(res.statusCode).toBe(200);
    const profile = await getProfileItem('u5');
    expect(profile?.plan).toBe('free');
  });

  it('400s when the signature header is missing', async () => {
    const res = await webhook(makeEvent({ httpMethod: 'POST', path: '/billing/webhook', body: '{}' }));
    expect(res.statusCode).toBe(400);
  });

  it('400s when signature verification fails', async () => {
    stripeMock.constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const res = await webhook(webhookEvent({}));
    expect(res.statusCode).toBe(400);
  });
});
