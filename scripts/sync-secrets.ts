import { config } from 'dotenv';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../apps/api/.env') });

const SECRET_NAME = 'ghosted/secrets';

const payload = {
  claudeApiKey:       process.env.CLAUDE_API_KEY       ?? '',
  geminiApiKey:       process.env.GEMINI_API_KEY       ?? '',
  encryptionKey:      process.env.ENCRYPTION_KEY       ?? '',
  gmailClientId:      process.env.GMAIL_CLIENT_ID      ?? '',
  gmailClientSecret:  process.env.GMAIL_CLIENT_SECRET  ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  stripeSecretKey:     process.env.STRIPE_SECRET_KEY     ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripePriceId:       process.env.STRIPE_PRICE_ID       ?? '',
};

const missing = Object.entries(payload).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing values in apps/api/.env: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new SecretsManagerClient({});
const secretString = JSON.stringify(payload, null, 2);

async function run() {
  try {
    await client.send(new PutSecretValueCommand({ SecretId: SECRET_NAME, SecretString: secretString }));
    console.log(`Updated ${SECRET_NAME}`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      await client.send(new CreateSecretCommand({ Name: SECRET_NAME, SecretString: secretString }));
      console.log(`Created ${SECRET_NAME}`);
    } else {
      throw err;
    }
  }
}

run().catch(err => { console.error(err); process.exit(1); });
