import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// 32-byte key for AES-256-GCM.
// Prod: set ENCRYPTION_KEY as a 64-char hex string.
// Local dev: all-zeros key is intentionally insecure — never use in prod.
const KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : Buffer.alloc(32, 0);

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv(12) || tag(16) || ciphertext
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decrypt(data: string): string {
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
