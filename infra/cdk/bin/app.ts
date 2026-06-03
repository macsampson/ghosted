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
  // Pass Google OAuth credentials via CDK context:
  //   cdk deploy --context googleClientId=... --context googleClientSecret=...
  // Or set them in cdk.context.json (gitignored)
  googleClientId: app.node.tryGetContext('googleClientId') ?? '',
  googleClientSecret: app.node.tryGetContext('googleClientSecret') ?? '',
});
