import { describe, it, expect, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GhostedStack } from '../lib/stacks/ghosted-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new GhostedStack(app, 'TestStack', {
    env: { account: '000000000000', region: 'us-east-1' },
    googleClientId: 'test-client-id',
  });
  template = Template.fromStack(stack);
});

/**
 * Regression guard for the resume view/download route.
 *
 * `GET /resumes/{versionId}/url` lives in both the Express server (local) and the
 * CDK API Gateway definition (prod). It was once present locally but missing from CDK,
 * so view/download worked locally but threw a CORS error in prod (the preflight hit a
 * non-existent resource). These assertions fail fast if that route disappears again.
 */
describe('resume download route', () => {
  it('exposes a "url" resource under /resumes/{versionId}', () => {
    const urlResources = template.findResources('AWS::ApiGateway::Resource', {
      Properties: { PathPart: 'url' },
    });
    expect(Object.keys(urlResources)).toHaveLength(1);
  });

  it('wires GET and the CORS preflight OPTIONS on the url resource', () => {
    const urlResources = template.findResources('AWS::ApiGateway::Resource', {
      Properties: { PathPart: 'url' },
    });
    const [urlLogicalId] = Object.keys(urlResources);

    // The route the frontend calls for view/download.
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: { Ref: urlLogicalId },
    });

    // defaultCorsPreflightOptions adds this OPTIONS preflight — without the resource
    // existing, there's no preflight and the browser reports a CORS error.
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      ResourceId: { Ref: urlLogicalId },
    });
  });
});
