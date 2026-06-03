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
  // Pass secrets via CDK context:
  //   cdk deploy --context googleClientId=... --context googleClientSecret=... \
  //     --context gmailClientId=... --context gmailClientSecret=... \
  //     --context encryptionKey=... --context claudeApiKey=... \
  //     --context acmCertificateArn=arn:aws:acm:us-east-1:...
  googleClientId: app.node.tryGetContext('googleClientId') ?? '',
  googleClientSecret: app.node.tryGetContext('googleClientSecret') ?? '',
  gmailClientId: app.node.tryGetContext('gmailClientId') ?? undefined,
  gmailClientSecret: app.node.tryGetContext('gmailClientSecret') ?? undefined,
  encryptionKey: app.node.tryGetContext('encryptionKey') ?? undefined,
  claudeApiKey: app.node.tryGetContext('claudeApiKey') ?? undefined,
  acmCertificateArn: app.node.tryGetContext('acmCertificateArn') ?? undefined,
});
