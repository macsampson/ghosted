# Post-mortem: Gmail email poller outage after secret rotation

- **Date of incident:** 2026-06-16 → 2026-06-17
- **Author:** Mac Sampson
- **Status:** Resolved
- **Severity:** High (email pipeline fully down for the only production user)
- **Components:** `apps/api` auth + email-poller Lambdas, `lib/crypto.ts`, `scripts/sync-secrets.ts`, AWS Secrets Manager (`ghosted/secrets`), Google OAuth

---

## Summary

A routine rotation of the `ENCRYPTION_KEY` used to encrypt Gmail refresh tokens cascaded
into a multi-hour outage of the email classification pipeline. What started as a single
decryption failure turned into a sequence of distinct, overlapping failures because each
fix exposed the next latent problem. The root causes were not one bug but three independent
landmines that the rotation stepped on in order:

1. **Stored ciphertext was orphaned** by the key rotation (expected, but unhandled).
2. **Lambdas cache secrets per container**, so the rotation never actually took effect until
   a forced cold start — and a no-op `cdk deploy` did not force one.
3. **`secrets:sync` is a blind full overwrite**, so syncing the new key silently clobbered the
   production `gmailClientSecret` with a stale value from local `.env`.

Total resolution required: re-encrypting the token, forcing Lambda cold starts via a config
change, and restoring the correct Gmail OAuth client secret.

---

## Impact

- The Gmail email poller threw on every scheduled invocation for user `fc2ed416-…`.
- No incoming emails were classified for the duration of the incident, so application
  statuses were not auto-updated.
- Only one production user exists, so blast radius was limited to a single account — but the
  pipeline was 100% down for that user.
- No data loss. The orphaned refresh token was unrecoverable, but a reconnect fully restored
  function.

---

## Timeline (causal, not strictly chronological)

1. **Trigger.** During a prior review it was found that the production `ENCRYPTION_KEY` may
   have been the all-zeros placeholder. The key was rotated to a real value and pushed with
   `npm run secrets:sync`.

2. **First symptom — decryption failure.** The email poller began throwing:
   ```
   Error: Unsupported state or unable to authenticate data
       at Decipheriv.final (node:internal/crypto/cipher)
       at decrypt (/src/lib/crypto.ts:27)
       at refreshAccessToken (/src/handlers/email-poller.ts:32)
   ```
   This is AES-256-GCM authentication-tag failure: the stored refresh-token ciphertext had
   been encrypted under the **old** key and could not be decrypted under the **new** one.
   GCM is authenticated encryption, so the orphaned token was unrecoverable by design.

3. **Attempted fix #1 — reconnect.** Diagnosed as expected fallout from the rotation; the fix
   is to re-encrypt by reconnecting Gmail. The user revoked Google access and signed out/in.

4. **Confusion — app login vs. Gmail grant.** Signing out/in re-establishes the Cognito/Google
   *app login*, which is a **separate** OAuth flow from the `gmail.readonly` *connection*. The
   stored refresh token was untouched by re-login. Also, the profile's `gmailConnected` flag
   stayed `true` the whole time (nothing resets it on decrypt failure), so the UI showed a
   green "Gmail connected" over a dead token, masking the real state.

5. **Second symptom — poll still failed after reconnect.** Root cause: **secrets are cached
   per Lambda container.** `lib/crypto.ts` resolves the key once at cold start into a
   module-level `keyPromise` and reuses it for the life of the warm container.
   `secrets:sync` only writes to Secrets Manager — it does **not** restart Lambdas. Warm
   containers from before the rotation were still holding the old key. The encrypting (auth)
   and decrypting (poller) Lambdas could disagree on the key depending on which containers
   were warm.

6. **Attempted fix #2 — `cdk deploy`.** The user redeployed, but CDK reported **"no changes."**
   With no asset/config diff, CloudFormation does not republish the functions, so **no
   containers were recycled** and the stale key persisted. This is the critical trap: a
   secret rotation plus a no-op deploy looks like a deploy but changes nothing at runtime.

7. **Fix for the cold-start trap.** Added a `SECRETS_VERSION` env var to the shared Lambda
   environment in the CDK stack. Bumping its value forces a config change on every function →
   new containers → fresh secret fetch. Redeployed (this time with real changes) so all
   crypto-touching Lambdas reloaded the current key.

8. **Third symptom — `no_refresh_token` on reconnect.** With the key issue resolved, the
   reconnect now failed at the OAuth callback with the app's `no_refresh_token` error. The
   handler (`auth.ts`) conflated two very different cases into one message, so it was unclear
   whether Google omitted the refresh token (re-consent case) or the token exchange itself
   failed.

9. **Reading the actual log resolved it.** `auth.ts` already logged the raw Google response.
   CloudWatch showed the truth:
   ```
   No refresh token in response: {
     error: 'invalid_client',
     error_description: 'The provided client secret is invalid.'
   }
   ```
   The Gmail OAuth **client secret** in Secrets Manager was invalid — Google rejected the
   token exchange before consent mattered. Revoking/reconnecting could never have fixed this.

10. **Root cause of the bad secret.** `scripts/sync-secrets.ts` rebuilds the **entire** secret
    payload from local `.env` and does a full `PutSecretValue`. When the new `ENCRYPTION_KEY`
    was synced, it also overwrote the production `gmailClientSecret` with a **stale** value
    from `.env` (a real `GOCSPX-…`-shaped secret, just no longer the one registered for the
    client). The `missing`-only guard in the script catches empty strings but not
    wrong-but-present values, so the clobber was silent.

11. **Resolution.** Restored the correct `GMAIL_CLIENT_SECRET` (recoverable from the
    `AWSPREVIOUS` version of the secret, which retains the pre-overwrite value), re-synced,
    bumped `SECRETS_VERSION`, redeployed to cold-start the Lambdas on the corrected secret,
    and reconnected Gmail. The token exchange succeeded, the token was encrypted under the
    current key, and the poller decrypted cleanly. **Pipeline restored.**

---

## Root causes

This was three independent failures stacked, each masked by the one before it:

### 1. Key rotation orphans existing ciphertext (no migration path)
AES-256-GCM is authenticated encryption: data encrypted under key A cannot be decrypted under
key B, full stop. Rotating `ENCRYPTION_KEY` instantly invalidated every stored Gmail refresh
token with no re-encryption strategy and no graceful handling — the poller simply threw on
every cycle, forever.

### 2. Secrets are cached per container; rotation needs a forced cold start
`lib/crypto.ts` loads the key once per container at cold start and caches it for the
container's lifetime. `secrets:sync` updates Secrets Manager but does not recycle Lambdas, and
a no-op `cdk deploy` does not republish functions. So "rotate + sync" (and even "rotate + sync
+ deploy") had **zero runtime effect**. There was no mechanism to force a key refresh.

### 3. `secrets:sync` is a blind, unguarded full overwrite
The script reconstructs the whole secret from `.env` and overwrites everything, trusting local
`.env` to be a perfect superset of production. It wasn't — `.env` held a stale
`gmailClientSecret`. A single-purpose "rotate the encryption key" action silently corrupted an
unrelated, working credential. The only guard rejects empty values, not stale or wrong ones.

### Contributing factors
- **UI masked the outage:** `gmailConnected` is never reset on a decrypt/auth failure, so the
  app showed "connected" over a dead token throughout.
- **Conflated error messaging:** `auth.ts` collapsed `invalid_client`, `invalid_grant`, and a
  genuinely-missing refresh token into one `no_refresh_token` message, sending us down the
  wrong path (revoke/reconnect) when the real cause was a bad secret.
- **App-login vs. Gmail-grant confusion:** two separate Google OAuth flows that are easy to
  conflate; re-logging-in felt like it should help but couldn't.

---

## What went well

- The raw Google response was already being logged in `auth.ts`, which is ultimately what
  cut through the guessing and identified `invalid_client`.
- `AWSPREVIOUS` on the Secrets Manager secret retained the pre-overwrite value, making the
  correct client secret recoverable without going back to Google Cloud Console.
- No data loss; a single reconnect fully restored the pipeline once the underlying issues were
  fixed.

## What went poorly

- Each fix uncovered a new failure, turning a one-line rotation into a multi-hour incident.
- Significant time was spent guessing (consent? key? data?) before reading the log that had
  the answer all along.
- A maintenance action silently corrupted an unrelated production credential.

---

## Action items

| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Add `SECRETS_VERSION` env var to force Lambda cold starts on secret rotation | Prevent | ✅ Done |
| 2 | Harden `scripts/sync-secrets.ts`: read existing secret, merge, show a diff of changes, and require confirmation before `PutSecretValue` (never blind-overwrite) | Prevent | ⬜ Proposed |
| 3 | Disambiguate OAuth errors in `auth.ts`: surface `invalid_client` / `invalid_grant` / token-exchange failures distinctly from a genuinely-missing refresh token | Detect | ⬜ Proposed |
| 4 | On decrypt/auth failure in the poller, set `gmailConnected = false` and drop the dead token so the UI reflects reality and prompts reconnect instead of erroring every cycle | Detect/Recover | ⬜ Proposed |
| 5 | Document the rotation runbook: rotating `ghosted/secrets` requires bumping `SECRETS_VERSION` and a real `cdk deploy`; `secrets:sync` alone does not recycle warm Lambdas | Process | ⬜ Proposed |
| 6 | Consider a token re-encryption / key-version scheme (e.g. tag ciphertext with key id) so future key rotations don't orphan stored tokens | Prevent | ⬜ Backlog |

---

## Lessons

- **Rotating a secret is not "done" when Secrets Manager is updated.** It's done when every
  consumer has reloaded it. Caching at cold start means you must force a cold start, and a
  no-op `cdk deploy` is not one.
- **`secrets:sync` overwriting from `.env` assumes `.env` is the source of truth for *every*
  field.** It isn't, and a blind overwrite turns a narrow change into a wide blast radius.
- **Read the log before forming a theory.** The decisive evidence (`invalid_client`) was
  logged from the start; hours went to hypotheses that the log would have ruled out.
- **Authenticated encryption has no recovery without the original key.** Plan key rotations
  with a re-encryption path, or expect to invalidate everything encrypted under the old key.
</content>
</invoke>
