import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface GhostedStackProps extends cdk.StackProps {
  googleClientId: string;
  googleClientSecret: string;
}

export class GhostedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GhostedStackProps) {
    super(scope, id, props);

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

    // Google as a federated identity provider
    // Requires googleClientId and googleClientSecret supplied at deploy time.
    if (props.googleClientId && props.googleClientSecret) {
      const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
        userPool,
        clientId: props.googleClientId,
        clientSecretValue: cdk.SecretValue.unsafePlainText(props.googleClientSecret),
        scopes: ['email', 'profile', 'openid', 'https://www.googleapis.com/auth/gmail.readonly'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
      userPool.registerIdentityProvider(googleProvider);
    }

    const userPoolDomain = userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: 'ghosted-app',
      },
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'ghosted-web',
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ['http://localhost:5173', 'https://ghosted.macsampson.com'],
        logoutUrls: ['http://localhost:5173', 'https://ghosted.macsampson.com'],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // ── DynamoDB (single-table) ───────────────────────────────────────────────

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'JobTracker',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: query applications by status sorted by date (pipeline view)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: find stale applications by last activity
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── S3 (resume PDFs) ──────────────────────────────────────────────────────

    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      bucketName: `ghosted-resumes-${this.account}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['http://localhost:5173', 'https://ghosted.macsampson.com'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Lambda shared environment ─────────────────────────────────────────────

    const sharedEnv = {
      TABLE_NAME: table.tableName,
      RESUME_BUCKET: resumeBucket.bucketName,
      USER_POOL_ID: userPool.userPoolId,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const lambdaDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
    };

    // ── Hello-world Lambda (end-to-end auth smoke test) ───────────────────────

    const helloFn = new lambda.Function(this, 'HelloFn', {
      ...lambdaDefaults,
      functionName: 'ghosted-hello',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../apps/api/dist/handlers')),
      handler: 'hello.handler',
      description: 'Auth smoke-test — returns the caller's Cognito sub and claims',
    });
    table.grantReadWriteData(helloFn);

    // ── API Gateway ───────────────────────────────────────────────────────────

    const api = new apigw.RestApi(this, 'Api', {
      restApiName: 'ghosted-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'ghosted-authorizer',
      identitySource: 'method.request.header.Authorization',
    });

    const authOptions: apigw.MethodOptions = {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    const helloResource = api.root.addResource('hello');
    helloResource.addMethod('GET', new apigw.LambdaIntegration(helloFn), authOptions);

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: userPoolDomain.baseUrl(),
    });
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'ResumeBucketName', { value: resumeBucket.bucketName });
  }
}
