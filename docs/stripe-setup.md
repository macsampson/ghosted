# Stripe setup, testing & deploy

How to wire real Stripe credentials, test payments end-to-end, and ship the Pro subscription.
The integration itself is already built — see `apps/api/src/handlers/billing.ts`,
`apps/api/src/lib/plan.ts`, and `apps/web/src/pages/Pricing.tsx`.

**Quick map of the moving parts**

| Thing | Where |
|---|---|
| Stripe secrets | `apps/api/.env` → `npm run secrets:sync` → Secrets Manager (`ghosted/secrets`) |
| Env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` |
| Webhook route | `POST /billing/webhook` (public, raw body, signature-verified) |
| Prod webhook URL | `https://u4uc1mbng1.execute-api.ca-west-1.amazonaws.com/prod/billing/webhook` |
| Limit enforcement | `PLAN_LIMITS_ENABLED` (unset locally; CDK sets `true` in prod) |
| Display price | `apps/web/src/lib/pricing.ts` (`PRO_PRICE.amount`) — must match the Stripe Price |

---

## A. Add the API keys

1. **Create the Pro Price** (Stripe Dashboard, **Test mode** toggle ON):
   Product catalog → **Add product** → name "Ghosted Pro" → **recurring, $5 / month** (match
   `PRO_PRICE` in `apps/web/src/lib/pricing.ts`, or change the constant to match). Copy the
   **Price ID** (`price_…`) → `STRIPE_PRICE_ID`.

2. **Secret key:** Developers → API keys → copy **Secret key** (`sk_test_…`).
   For production, prefer a **restricted key** scoped to *write* on Checkout Sessions, Billing
   Portal Sessions, Customers, Subscriptions, and *read* on Events — instead of the full key.

3. **Webhook signing secret** depends on the endpoint:
   - Local → printed by the `stripe listen` CLI (step B2).
   - Prod → from the dashboard webhook endpoint you register (step C3). A *different* `whsec_…`.

4. **Activate the Customer Portal** (Settings → Billing → Customer portal → **Activate**) in
   **both** test and live modes — `billingPortal.sessions.create` returns 500 until this is done.

5. **Put them in `apps/api/.env`** (gitignored — never commit):
   ```dotenv
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_ID=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...        # filled in step B2 for local
   # Optional: exercise the free-tier caps locally
   # PLAN_LIMITS_ENABLED=true
   ```

---

## B. Test the payments (local, test mode)

1. **Start everything:**
   ```bash
   docker compose up -d
   npm run dev          # API :3001, web :5173 (auth bypass = signed in as the dev user)
   ```

2. **Forward webhooks** (separate terminal; run `stripe login` once first):
   ```bash
   stripe listen --forward-to localhost:3001/billing/webhook
   ```
   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` in `.env`, then restart `npm run dev`.

3. **Run the upgrade flow:** http://localhost:5173 → Settings (or `/pricing`) →
   **Upgrade to Pro / Get Pro** → redirected to Stripe Checkout.

4. **Pay with a test card** (test mode only; any future expiry, any 3-digit CVC, any ZIP):

   | Scenario | Card |
   |---|---|
   | ✓ Success | `4242 4242 4242 4242` |
   | ⚠️ 3D Secure (auth required) | `4000 0025 0000 3155` |
   | ✗ Generic decline | `4000 0000 0000 0002` |
   | ✗ Insufficient funds | `4000 0000 0000 9995` |
   | ✗ Lost card | `4000 0000 0000 9987` |

   Full list: https://docs.stripe.com/testing

5. **Verify the round-trip:** after success, `stripe listen` logs
   `checkout.session.completed` → the webhook flips the profile, and Settings shows **Pro /
   Manage billing**. The DynamoDB `PROFILE` item gains `plan: 'pro'`, `subscriptionStatus`,
   `stripeSubscriptionId`.

6. **Test downgrade:** **Manage billing** → cancel (or `stripe trigger
   customer.subscription.deleted`) → profile returns to `free`.

7. **Test the limits:** set `PLAN_LIMITS_ENABLED=true` and restart, then as a free user create a
   26th application or a 2nd resume → **402** → the `UpgradeNotice` banner appears.

> The automated suite already covers checkout/webhook/limits with a mocked Stripe SDK
> (`apps/api/src/__tests__/billing.test.ts`, `plan.test.ts`): `npm test --workspace=apps/api`.

---

## C. Deploy to production

1. **Switch `.env` to live values** (or keep test mode for a soft launch):
   `STRIPE_SECRET_KEY=sk_live_…` (or a restricted live key) and `STRIPE_PRICE_ID=price_…` from a
   **live-mode** Product/Price. `secrets:sync` reads `.env` wholesale, so it must hold the values
   you want in prod at sync time.

2. **Push secrets + deploy:**
   ```bash
   npm run secrets:sync                      # → ghosted/secrets
   npm run build --workspace=apps/api
   npm run build --workspace=apps/web
   cd infra/cdk && cdk deploy                 # adds the ghosted-billing Lambda + /billing routes
   ```

3. **Register the live webhook** (Dashboard → Developers → Webhooks → Add endpoint):
   - URL: `https://u4uc1mbng1.execute-api.ca-west-1.amazonaws.com/prod/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy its signing secret → set `STRIPE_WEBHOOK_SECRET` in `.env` → **re-run `npm run
     secrets:sync`** (this secret only exists once the endpoint is created).

4. **Publish the frontend** (bucket/dist id from the stack's `SpaBucketName` /
   `CloudFrontDistributionId` outputs):
   ```bash
   aws s3 sync apps/web/dist s3://<spa-bucket-name>
   aws cloudfront create-invalidation --distribution-id <dist-id> --paths "/*"
   ```

5. **Smoke test in prod:** sign in at ghosted.macsampson.com → upgrade with a real card (or a
   live $5 charge you refund) → confirm the webhook fired (Dashboard → Webhooks → endpoint →
   recent deliveries) and the profile flipped to Pro.

### Gotchas
- Customer Portal must be activated in **live** mode too (separate from test).
- `secrets:sync` requires every key in `.env` to be non-empty — keep the other secrets present.
- `STRIPE_WEBHOOK_SECRET` differs between local (`stripe listen`) and each dashboard endpoint.
- The `/pricing` price is display-only (`lib/pricing.ts`); the charged amount is the Stripe
  Price — keep them in sync.
