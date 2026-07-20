import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface GhostedStackProps extends cdk.StackProps {
  googleClientId: string;
  // ARN of an ACM certificate in us-east-1 for the custom domain (see appDomain).
  acmCertificateArn?: string;
  // Public custom domain for the SPA (e.g. 'app.example.com'). When set alongside
  // acmCertificateArn, CloudFront serves it; it's also added to the Cognito callback/
  // logout allow-lists and the S3 CORS origins, and used as FRONTEND_URL. Omit for a
  // localhost-only / CloudFront-default-domain deploy.
  appDomain?: string;
  // OAuth callback URL registered with Google for the Gmail connect flow. Defaults to
  // the local dev callback. In prod pass your API Gateway (or custom API domain) callback,
  // e.g. --context gmailRedirectUri=https://<api-id>.execute-api.<region>.amazonaws.com/prod/auth/gmail/callback
  gmailRedirectUri?: string;
  // Verified SES sender for notification + digest emails (e.g. 'noreply@example.com').
  sesFromEmail?: string;
  // Runtime secrets live in Secrets Manager under the name 'ghosted/secrets'.
  // Keys: googleClientSecret, gmailClientSecret, encryptionKey, claudeApiKey, geminiApiKey
  // See apps/api/.env.example for the full aws CLI command to populate them.
}

export class GhostedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GhostedStackProps) {
    super(scope, id, props);

    // ── Environment-specific config (parameterized so the stack is reproducible) ──
    // Web origins allowed through Cognito OAuth + S3 CORS. localhost is always present
    // for dev; the custom domain is added when configured.
    const appOrigins = [
      'http://localhost:5173',
      ...(props.appDomain ? [`https://${props.appDomain}`] : []),
    ];
    const frontendUrl = props.appDomain ? `https://${props.appDomain}` : 'http://localhost:5173';
    const gmailRedirectUri = props.gmailRedirectUri ?? 'http://localhost:3001/auth/gmail/callback';
    const sesFromEmail = props.sesFromEmail ?? 'noreply@example.com';

    // ── Secrets Manager ──────────────────────────────────────────────────────

    // Import the pre-existing secret. See apps/api/.env.example for the populate command.
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', 'ghosted/secrets');

    // ── Cognito ──────────────────────────────────────────────────────────────

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'ghosted-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (props.googleClientId) {
      googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
        userPool,
        clientId: props.googleClientId,
        clientSecretValue: appSecrets.secretValueFromJson('googleClientSecret'),
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
      userPool.registerIdentityProvider(googleProvider);
    }

    const userPoolDomain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: 'ghosted-app' },
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'ghosted-web',
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: appOrigins,
        logoutUrls: appOrigins,
      },
      supportedIdentityProviders: [
        ...(props.googleClientId ? [cognito.UserPoolClientIdentityProvider.GOOGLE] : []),
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    if (googleProvider) {
      userPoolClient.node.addDependency(googleProvider);
    }

    // ── DynamoDB (single-table) ───────────────────────────────────────────────

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'JobTracker',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // OAUTH_STATE records carry an `expiresAt` (epoch seconds); DynamoDB TTL sweeps
      // them after expiry. Other entities omit the attribute and are never auto-deleted.
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── S3 (resume PDFs) ──────────────────────────────────────────────────────

    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      bucketName: `ghosted-resumes-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: appOrigins,
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── S3 (SPA) ──────────────────────────────────────────────────────────────

    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `ghosted-spa-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── SQS (email pipeline) ──────────────────────────────────────────────────

    const emailDlq = new sqs.Queue(this, 'EmailDlq', {
      queueName: 'ghosted-email-dlq.fifo',
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const emailQueue = new sqs.Queue(this, 'EmailQueue', {
      queueName: 'ghosted-email-queue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: { queue: emailDlq, maxReceiveCount: 3 },
    });

    // ── Shared Lambda config ──────────────────────────────────────────────────

    const apiHandlerPath = path.join(__dirname, '../../../../apps/api/dist/handlers');

    const sharedEnv: Record<string, string> = {
      TABLE_NAME: table.tableName,
      RESUME_BUCKET: resumeBucket.bucketName,
      USER_POOL_ID: userPool.userPoolId,
      NODE_OPTIONS: '--enable-source-maps',
      FRONTEND_URL: frontendUrl,
      SECRETS_ARN: appSecrets.secretArn,
      // Bump this whenever you rotate a value in 'ghosted/secrets'. Lambdas cache
      // secrets once per container at cold start (lib/crypto.ts), so a secret
      // rotation has no effect until the function config changes and forces new
      // containers. Changing this value makes `cdk deploy` recycle every Lambda.
      SECRETS_VERSION: '2026-06-172',
    };

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
    };

    // ── API Lambdas ───────────────────────────────────────────────────────────

    const helloFn = new lambda.Function(this, 'HelloFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-hello',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'hello.handler',
    });

    const applicationsFn = new lambda.Function(this, 'ApplicationsFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-applications',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'applications.handler',
    });

    const resumesFn = new lambda.Function(this, 'ResumesFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-resumes',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'resumes.handler',
    });

    const authFn = new lambda.Function(this, 'AuthFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-auth',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'auth.handler',
      environment: {
        ...sharedEnv,
        GMAIL_REDIRECT_URI: gmailRedirectUri,
      },
    });

    const emailsFn = new lambda.Function(this, 'EmailsFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-emails',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'emails.handler',
    });

    // ── Email pipeline Lambdas ────────────────────────────────────────────────

    const emailPollerFn = new lambda.Function(this, 'EmailPollerFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-email-poller',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'email-poller.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...sharedEnv,
        EMAIL_QUEUE_URL: emailQueue.queueUrl,
      },
    });

    const classifierFn = new lambda.Function(this, 'ClassifierFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-classifier',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'classifier.handler',
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      environment: {
        ...sharedEnv,
        SES_FROM_EMAIL: sesFromEmail,
      },
    });

    // ── Stale digest Lambda ───────────────────────────────────────────────────

    const staleDigestFn = new lambda.Function(this, 'StaleDigestFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-stale-digest',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'stale-digest.handler',
      timeout: cdk.Duration.minutes(5),
      environment: { ...sharedEnv, SES_FROM_EMAIL: sesFromEmail },
    });

    // ── IAM ──────────────────────────────────────────────────────────────────

    table.grantReadWriteData(helloFn);
    table.grantReadWriteData(applicationsFn);
    table.grantReadWriteData(resumesFn);
    table.grantReadWriteData(authFn);
    table.grantReadWriteData(emailsFn);
    table.grantReadWriteData(emailPollerFn);
    table.grantReadWriteData(classifierFn);
    table.grantReadWriteData(staleDigestFn);

    resumeBucket.grantReadWrite(resumesFn);

    // Secrets Manager read access for Lambdas that fetch runtime secrets
    for (const fn of [authFn, emailPollerFn, classifierFn]) {
      appSecrets.grantRead(fn);
    }

    emailQueue.grantSendMessages(emailPollerFn);
    emailQueue.grantConsumeMessages(classifierFn);

    const sesEmailPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    });
    classifierFn.addToRolePolicy(sesEmailPolicy);
    staleDigestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    // ── SQS → Classifier trigger ──────────────────────────────────────────────

    classifierFn.addEventSource(
      new lambdaEventSources.SqsEventSource(emailQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // ── EventBridge schedule (every 15 min) ───────────────────────────────────

    const pollerRule = new events.Rule(this, 'EmailPollerSchedule', {
      ruleName: 'ghosted-email-poller-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    pollerRule.addTarget(new targets.LambdaFunction(emailPollerFn));

    const dailyDigestRule = new events.Rule(this, 'DailyDigestSchedule', {
      ruleName: 'ghosted-daily-digest-schedule',
      schedule: events.Schedule.cron({ hour: '14', minute: '0' }), // 9am ET
    });
    dailyDigestRule.addTarget(new targets.LambdaFunction(staleDigestFn));

    // ── API Gateway ───────────────────────────────────────────────────────────

    const api = new apigw.RestApi(this, 'Api', {
      restApiName: 'ghosted-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: { stageName: 'prod', tracingEnabled: true },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'ghosted-authorizer',
      identitySource: 'method.request.header.Authorization',
    });

    const auth: apigw.MethodOptions = {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    const noAuth: apigw.MethodOptions = {
      authorizationType: apigw.AuthorizationType.NONE,
    };

    // /hello
    api.root.addResource('hello').addMethod('GET', new apigw.LambdaIntegration(helloFn), auth);

    // /profile
    api.root.addResource('profile').addMethod('GET', new apigw.LambdaIntegration(authFn), auth);

    // /applications
    const appsRes = api.root.addResource('applications');
    appsRes.addMethod('GET', new apigw.LambdaIntegration(applicationsFn), auth);
    appsRes.addMethod('POST', new apigw.LambdaIntegration(applicationsFn), auth);
    const appItem = appsRes.addResource('{appId}');
    appItem.addMethod('GET', new apigw.LambdaIntegration(applicationsFn), auth);
    appItem.addMethod('PUT', new apigw.LambdaIntegration(applicationsFn), auth);
    appItem.addMethod('DELETE', new apigw.LambdaIntegration(applicationsFn), auth);

    // /resumes
    const resumesRes = api.root.addResource('resumes');
    resumesRes.addMethod('GET', new apigw.LambdaIntegration(resumesFn), auth);
    resumesRes.addResource('upload-url').addMethod('POST', new apigw.LambdaIntegration(resumesFn), auth);
    const resumeItem = resumesRes.addResource('{versionId}');
    resumeItem.addMethod('DELETE', new apigw.LambdaIntegration(resumesFn), auth);
    resumeItem.addResource('url').addMethod('GET', new apigw.LambdaIntegration(resumesFn), auth);

    // /auth/gmail — start (authenticated) + callback (unauthenticated)
    const authRes = api.root.addResource('auth');
    const gmailRes = authRes.addResource('gmail');
    gmailRes.addResource('start').addMethod('POST', new apigw.LambdaIntegration(authFn), auth);
    gmailRes.addResource('callback').addMethod('GET', new apigw.LambdaIntegration(authFn), noAuth);

    // /emails
    const emailsRes = api.root.addResource('emails');
    emailsRes.addMethod('GET', new apigw.LambdaIntegration(emailsFn), auth);
    const emailItem = emailsRes.addResource('{emailId}');
    emailItem.addResource('confirm').addMethod('POST', new apigw.LambdaIntegration(emailsFn), auth);
    emailItem.addResource('dismiss').addMethod('POST', new apigw.LambdaIntegration(emailsFn), auth);

    // ── CloudFront distribution ───────────────────────────────────────────────

    const certificate = props.acmCertificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.acmCertificateArn)
      : undefined;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: certificate && props.appDomain ? [props.appDomain] : undefined,
      certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        // Both 403 and 404 serve index.html so React Router handles client-side routing.
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // ── GitHub Actions OIDC + deploy role ─────────────────────────────────────
    // Federated identity for the GitHub Actions deploy workflows. These were first
    // created out-of-band; they're modeled here so the deploy identity is IaC too.
    // The OIDC provider is an account-level singleton (one per URL), so it's retained
    // on stack deletion rather than destroyed.
    const githubQualifier = cdk.DefaultStackSynthesizer.DEFAULT_QUALIFIER; // 'hnb659fds'

    const githubOidcProvider = new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIdList: ['sts.amazonaws.com'],
      thumbprintList: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });
    githubOidcProvider.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const githubDeployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'ghosted-github-deploy',
      maxSessionDuration: cdk.Duration.hours(1),
      // Trust GitHub Actions from this repo (any branch/workflow) via OIDC.
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.attrArn,
        {
          StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
          StringLike: { 'token.actions.githubusercontent.com:sub': 'repo:macsampson/ghosted:*' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      inlinePolicies: {
        // Frontend deploy job: sync the SPA bucket + bust the CloudFront cache.
        'ghosted-deploy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
              resources: [spaBucket.bucketArn, spaBucket.arnForObjects('*')],
            }),
            new iam.PolicyStatement({
              actions: ['cloudfront:CreateInvalidation'],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
            }),
          ],
        }),
        // Infra deploy job: assume the CDK bootstrap roles + read the bootstrap version.
        'cdk-deploy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:aws:iam::${this.account}:role/cdk-${githubQualifier}-*`],
            }),
            new iam.PolicyStatement({
              actions: ['ssm:GetParameter'],
              resources: [`arn:aws:ssm:*:${this.account}:parameter/cdk-bootstrap/${githubQualifier}/version`],
            }),
          ],
        }),
      },
    });
    // Account-level deploy identity — keep it if the app stack is ever torn down.
    githubDeployRole.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: userPoolDomain.baseUrl() });
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'ResumeBucketName', { value: resumeBucket.bucketName });
    new cdk.CfnOutput(this, 'EmailQueueUrl', { value: emailQueue.queueUrl });
    new cdk.CfnOutput(this, 'SpaBucketName', { value: spaBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: distribution.distributionId });
  }
}
