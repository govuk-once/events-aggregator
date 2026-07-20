import { beforeEach, describe, test, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';

import { RoleHelper, Operations } from '../RoleHelper';

/* eslint-disable @typescript-eslint/no-explicit-any */
const getStatementsForRoleId = (template: Template, roleId: string): any[] => {
  const roles = template.findResources('AWS::IAM::Role');
  const roleLogicalIds = Object.keys(roles).filter((id) => id.includes(roleId));

  expect(roleLogicalIds.length).toBeGreaterThan(0);

  const policies = template.findResources('AWS::IAM::Policy');

  const attachedPolicies = Object.values(policies).filter((pol: any) =>
    (pol.Properties?.Roles ?? []).some(
      (role: any) =>
        typeof role === 'object' &&
        role.Ref &&
        roleLogicalIds.includes(role.Ref),
    ),
  ) as any[];

  return attachedPolicies
    .map((pol: any) => pol.Properties?.PolicyDocument ?? [])
    .flat();
};

const getStatementsForAnyRole = (template: Template): any[] => {
  const policies = template.findResources('AWS::IAM::Policy');
  const attachedPolicies = Object.values(policies).filter((pol: any) =>
    (pol.Properties?.Roles ?? []).some(
      (role: any) => typeof role === 'object' && role.Ref,
    ),
  ) as any[];

  return attachedPolicies
    .map((pol: any) => pol.Properties?.PolicyDocument ?? [])
    .flat();
};

describe(`RoleHelper tests`, () => {
  let app: App;
  let stack: Stack;
  let fn: lambda.IFunction;
  let roleHelper: RoleHelper;

  const serviceName = 'dataService';

  beforeEach(() => {
    // const environment = getEnvironment();
    app = new App();
    stack = new Stack(app, 'teststack');

    roleHelper = new RoleHelper(stack, serviceName);

    fn = new lambda.Function(stack, 'testfunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok"})',
      ),
    });
  });

  test('adds Dynamodb read permissions to an explicit role', () => {
    const fn = new lambda.Function(stack, 'Fn', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    const table = new dynamodb.Table(stack, 'testTable', {
      tableName: 'customer',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const role = new iam.Role(stack, 'ExplicitRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    roleHelper.addDynamoOperationPermissionsToLambda({
      id: 'RoleHelperDynamo',
      lambda: fn,
      table: table,
      operations: [Operations.READ],
      role: role,
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForRoleId(template, 'ExplicitRole');
    const jStatements = JSON.stringify(statements);

    expect(jStatements).toContain('dynamodb:BatchGetItem');
    expect(jStatements).toContain('dynamodb:DescribeTable');
    expect(jStatements).toContain('dynamodb:GetItem');
    expect(jStatements).toContain('dynamodb:Scan');
    expect(jStatements).toContain('dynamodb:Query');
  });

  test('adds Dynamodb crete/Update/delete permissions to an explicit role', () => {
    const fn = new lambda.Function(stack, 'Fn', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    const table = new dynamodb.Table(stack, 'testTable', {
      tableName: 'customer',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    roleHelper.addDynamoOperationPermissionsToLambda({
      id: 'RoleHelperDynamo',
      lambda: fn,
      table: table,
      operations: [Operations.CREATE, Operations.UPDATE, Operations.DELETE],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const jStatements = JSON.stringify(statements);

    expect(jStatements).toContain('dynamodb:PutItem');
    expect(jStatements).toContain('dynamodb:DeleteItem');
    expect(jStatements).toContain('dynamodb:UpdateItem');
  });

  test('it can add read policy to an s3', () => {
    const bucket = new s3.Bucket(stack, 'bucket', {
      bucketName: 'testbucket',
    });

    roleHelper.addS3OperationPermissionsToLambda({
      id: 'buckerPermissions',
      lambda: fn,
      bucket: bucket,
      operations: [Operations.READ],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const flatStatements = JSON.stringify(statements);

    expect(flatStatements).toContain('s3:ListBucket');
    expect(flatStatements).toContain('s3:GetObject');
  });

  test('it can add update policy to an s3', () => {
    const bucket = new s3.Bucket(stack, 'bucket', {
      bucketName: 'testbucket',
    });

    roleHelper.addS3OperationPermissionsToLambda({
      id: 'buckerPermissions',
      lambda: fn,
      bucket: bucket,
      operations: [Operations.UPDATE],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const flatStatements = JSON.stringify(statements);

    expect(flatStatements).toContain('s3:PutObject');
    expect(flatStatements).toContain('s3:PutObjectTagging');
  });

  test('it can add delete policy to an s3', () => {
    const bucket = new s3.Bucket(stack, 'bucket', {
      bucketName: 'testbucket',
    });

    roleHelper.addS3OperationPermissionsToLambda({
      id: 'buckerPermissions',
      lambda: fn,
      bucket: bucket,
      operations: [Operations.DELETE],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const flatStatements = JSON.stringify(statements);

    expect(flatStatements).toContain('s3:DeleteObject');
  });

  test('it can add create policy to an s3', () => {
    const bucket = new s3.Bucket(stack, 'bucket', {
      bucketName: 'testbucket',
    });

    roleHelper.addS3OperationPermissionsToLambda({
      id: 'buckerPermissions',
      lambda: fn,
      bucket: bucket,
      operations: [Operations.CREATE],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const flatStatements = JSON.stringify(statements);

    expect(flatStatements).toContain('s3:PutObject');
    expect(flatStatements).toContain('3:AbortMultipartUpload');
    expect(flatStatements).toContain('s3:ListMultipartUploadParts');
  });

  test('it can add create/Read/Update/Delete policy to an s3', () => {
    const bucket = new s3.Bucket(stack, 'bucket', {
      bucketName: 'testbucket',
    });

    roleHelper.addS3OperationPermissionsToLambda({
      id: 'buckerPermissions',
      lambda: fn,
      bucket: bucket,
      operations: [
        Operations.CREATE,
        Operations.READ,
        Operations.UPDATE,
        Operations.DELETE,
      ],
    });

    const template = Template.fromStack(stack);

    const statements = getStatementsForAnyRole(template);
    const flatStatements = JSON.stringify(statements);

    expect(flatStatements).toContain('s3:PutObject');
    expect(flatStatements).toContain('3:AbortMultipartUpload');
    expect(flatStatements).toContain('s3:ListMultipartUploadParts');
    expect(flatStatements).toContain('s3:ListBucket');
    expect(flatStatements).toContain('s3:GetObject');
    expect(flatStatements).toContain('s3:PutObject');
    expect(flatStatements).toContain('s3:PutObjectTagging');
    expect(flatStatements).toContain('s3:DeleteObject');
  });
});
