#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GhostedStack } from '../lib/stacks/ghosted-stack';

const app = new cdk.App();

new GhostedStack(app, 'GhostedStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  // Non-secret config passed as CDK context (see cdk.json `context`) or env vars:
  //   cdk deploy --context googleClientId=... \
  //     --context acmCertificateArn=arn:aws:acm:us-east-1:... \
  //     --context gmailRedirectUri=https://<api-id>.execute-api.<region>.amazonaws.com/prod/auth/gmail/callback
  //
  // Runtime secrets live in Secrets Manager (ghosted/secrets) — not passed here.
  googleClientId: app.node.tryGetContext('googleClientId') ?? process.env.GOOGLE_CLIENT_ID ?? '',
  acmCertificateArn: app.node.tryGetContext('acmCertificateArn') ?? process.env.ACM_CERTIFICATE_ARN ?? undefined,
  appDomain: app.node.tryGetContext('appDomain') ?? process.env.APP_DOMAIN ?? undefined,
  // Holds the API Gateway id, so it's kept out of source — pass at deploy via
  // --context gmailRedirectUri=... or the GMAIL_REDIRECT_URI env var.
  gmailRedirectUri: app.node.tryGetContext('gmailRedirectUri') ?? process.env.GMAIL_REDIRECT_URI ?? undefined,
  sesFromEmail: app.node.tryGetContext('sesFromEmail') ?? process.env.SES_FROM_EMAIL ?? undefined,
});
