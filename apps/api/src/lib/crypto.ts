import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getSecrets } from './secrets';

// Pre-load at cold start alongside the secrets fetch.
const keyPromise = getSecrets().then(s =>
  s.encryptionKey ? Buffer.from(s.encryptionKey, 'hex') : Buffer.alloc(32, 0),
);

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
