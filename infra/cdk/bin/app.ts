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
  // Non-secret config passed as CDK context:
  //   cdk deploy --context googleClientId=... \
  //     --context gmailClientId=... \
  //     --context acmCertificateArn=arn:aws:acm:us-east-1:...
  //
  // Runtime secrets live in Secrets Manager (ghosted/secrets) — not passed here.
  googleClientId: app.node.tryGetContext('googleClientId') ?? process.env.GOOGLE_CLIENT_ID ?? '',
  gmailClientId: app.node.tryGetContext('gmailClientId') ?? process.env.GMAIL_CLIENT_ID ?? undefined,
  acmCertificateArn: app.node.tryGetContext('acmCertificateArn') ?? undefined,
});
