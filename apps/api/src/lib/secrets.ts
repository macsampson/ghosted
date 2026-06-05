import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface AppSecrets {
  claudeApiKey: string;
  geminiApiKey: string;
  encryptionKey: string;
  gmailClientSecret: string;
  googleClientSecret: string;
}

function load(): Promise<AppSecrets> {
  if (process.env.DYNAMODB_ENDPOINT) {
    return Promise.resolve({
      claudeApiKey: process.env.CLAUDE_API_KEY ?? '',
      geminiApiKey: process.env.GEMINI_API_KEY ?? '',
      encryptionKey: process.env.ENCRYPTION_KEY ?? '',
      gmailClientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    });
  }
  return new SecretsManagerClient({})
    .send(new GetSecretValueCommand({ SecretId: process.env.SECRETS_ARN! }))
    .then(r => JSON.parse(r.SecretString!) as AppSecrets);
}

// Starts fetching at cold start; resolves once and is reused on warm invocations.
const promise = load();

export const getSecrets = () => promise;
