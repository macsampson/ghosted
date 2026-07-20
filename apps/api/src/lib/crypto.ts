import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getSecrets } from './secrets';

// Pre-load at cold start alongside the secrets fetch.
const keyPromise = getSecrets().then(s => {
  if (s.encryptionKey) {
    const key = Buffer.from(s.encryptionKey, 'hex');
    if (key.length !== 32) {
      throw new Error(`encryptionKey must be 32 bytes (64 hex chars); got ${key.length}`);
    }
    return key;
  }
  // Local dev / tests run against DynamoDB Local and may omit the key — fall back to a
  // well-known dev key so the flow still works. In production (a real Lambda, where
  // DYNAMODB_ENDPOINT is unset) a missing key is a fatal misconfiguration: never silently
  // encrypt Gmail refresh tokens under a guessable all-zero key.
  if (process.env.DYNAMODB_ENDPOINT) return Buffer.alloc(32, 0);
  throw new Error('encryptionKey is missing from Secrets Manager — refusing to encrypt under a zero key');
});

export async function encrypt(plaintext: string): Promise<string> {
  const key = await keyPromise;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv(12) || tag(16) || ciphertext
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export async function decrypt(data: string): Promise<string> {
  const key = await keyPromise;
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
