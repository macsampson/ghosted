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
  // ARN of an ACM certificate in us-east-1 for ghosted.macsampson.com.
  acmCertificateArn?: string;
  // Runtime secrets live in Secrets Manager under the name 'ghosted/secrets'.
  // Keys: googleClientSecret, gmailClientSecret, encryptionKey, claudeApiKey, geminiApiKey
  // See apps/api/.env.example for the full aws CLI command to populate them.
}

export class GhostedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GhostedStackProps) {
    super(scope, id, props);

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
        callbackUrls: ['http://localhost:5173', 'https://dhh29wyrsdw31.cloudfront.net', 'https://ghosted.macsampson.com'],
        logoutUrls: ['http://localhost:5173', 'https://dhh29wyrsdw31.cloudfront.net', 'https://ghosted.macsampson.com'],
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
          allowedOrigins: ['http://localhost:5173', 'https://dhh29wyrsdw31.cloudfront.net', 'https://ghosted.macsampson.com'],
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
      FRONTEND_URL: 'https://ghosted.macsampson.com',
      SECRETS_ARN: appSecrets.secretArn,
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
        GMAIL_REDIRECT_URI: 'https://u4uc1mbng1.execute-api.ca-west-1.amazonaws.com/prod/auth/gmail/callback',
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
        SES_FROM_EMAIL: 'noreply@macsampson.com',
      },
    });

    // ── Stale digest Lambda ───────────────────────────────────────────────────

    const staleDigestFn = new lambda.Function(this, 'StaleDigestFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-stale-digest',
      code: lambda.Code.fromAsset(apiHandlerPath),
      handler: 'stale-digest.handler',
      timeout: cdk.Duration.minutes(5),
      environment: { ...sharedEnv, SES_FROM_EMAIL: 'noreply@macsampson.com' },
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
      domainNames: certificate ? ['ghosted.macsampson.com'] : undefined,
      certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        // Both 403 and 404 serve index.html so React Router handles client-side routing.
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

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
