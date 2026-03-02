import { describe, it, expect } from 'vitest';

import {
  makeApprovalGate,
  makeArtifact,
  makeAutoScalingConfig,
  makeCDPipeline,
  makeCIJob,
  makeCIPipeline,
  makeCIStage,
  makeDeployment,
  makeDeploymentStrategy,
  makeEnvironment,
  makeEnvironmentVariable,
  makeHealthCheckResult,
  makeInfrastructureConfig,
  makeJobStep,
  makeNetworkConfig,
  makePipelineNotification,
  makeResourceConfig,
  makeRollbackConfig,
  makeSecretAccessLog,
  makeSecretMetadata,
  makeSecretReference,
  makeSecurityConfig,
} from './testHelpers.js';

// ─── CI Pipeline Factories ───────────────────────────────────────────────────

describe('makeJobStep', () => {
  it('should return defaults', () => {
    const step = makeJobStep();
    expect(step.name).toBe('Checkout code');
    expect(step.uses).toBe('actions/checkout@v4');
  });

  it('should accept overrides', () => {
    const step = makeJobStep({ name: 'Run tests', run: 'npm test', uses: undefined });
    expect(step.name).toBe('Run tests');
    expect(step.run).toBe('npm test');
    expect(step.uses).toBeUndefined();
  });
});

describe('makeCIJob', () => {
  it('should return defaults', () => {
    const job = makeCIJob();
    expect(job.name).toBe('lint');
    expect(job.runner).toBe('ubuntu-latest');
    expect(job.steps).toHaveLength(1);
    expect(job.timeout).toBe(10);
    expect(job.retries).toBe(1);
  });

  it('should accept overrides', () => {
    const job = makeCIJob({ name: 'test', timeout: 30 });
    expect(job.name).toBe('test');
    expect(job.timeout).toBe(30);
    expect(job.runner).toBe('ubuntu-latest');
  });
});

describe('makeCIStage', () => {
  it('should return defaults', () => {
    const stage = makeCIStage();
    expect(stage.name).toBe('lint');
    expect(stage.jobs).toHaveLength(1);
    expect(stage.dependsOn).toBeUndefined();
  });

  it('should accept overrides', () => {
    const stage = makeCIStage({ name: 'test', dependsOn: ['lint'] });
    expect(stage.name).toBe('test');
    expect(stage.dependsOn).toEqual(['lint']);
  });
});

describe('makeArtifact', () => {
  it('should return defaults', () => {
    const artifact = makeArtifact();
    expect(artifact.name).toBe('build-output');
    expect(artifact.path).toBe('dist/');
    expect(artifact.retentionDays).toBe(7);
  });

  it('should accept overrides', () => {
    const artifact = makeArtifact({ name: 'docker-image', retentionDays: 30 });
    expect(artifact.name).toBe('docker-image');
    expect(artifact.retentionDays).toBe(30);
  });
});

describe('makePipelineNotification', () => {
  it('should return defaults', () => {
    const notif = makePipelineNotification();
    expect(notif.channel).toBe('slack');
    expect(notif.events).toEqual(['failure']);
    expect(notif.target).toBe('#deployments');
  });

  it('should accept overrides', () => {
    const notif = makePipelineNotification({ events: ['success', 'failure'], target: '#ci' });
    expect(notif.events).toEqual(['success', 'failure']);
    expect(notif.target).toBe('#ci');
  });
});

describe('makeCIPipeline', () => {
  it('should return defaults', () => {
    const pipeline = makeCIPipeline();
    expect(pipeline.trigger).toBe('pull_request');
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.artifacts).toHaveLength(1);
    expect(pipeline.notifications).toHaveLength(1);
  });

  it('should accept overrides', () => {
    const pipeline = makeCIPipeline({ trigger: 'push' });
    expect(pipeline.trigger).toBe('push');
  });
});

// ─── CD Pipeline Factories ───────────────────────────────────────────────────

describe('makeEnvironmentVariable', () => {
  it('should return defaults', () => {
    const envVar = makeEnvironmentVariable();
    expect(envVar.name).toBe('NODE_ENV');
    expect(envVar.value).toBe('staging');
  });

  it('should accept overrides', () => {
    const envVar = makeEnvironmentVariable({ name: 'API_URL', value: 'https://api.cashtrace.ng' });
    expect(envVar.name).toBe('API_URL');
    expect(envVar.value).toBe('https://api.cashtrace.ng');
  });
});

describe('makeSecretReference', () => {
  it('should return defaults', () => {
    const ref = makeSecretReference();
    expect(ref.name).toBe('database-url');
    expect(ref.envVar).toBe('DATABASE_URL');
  });

  it('should accept overrides', () => {
    const ref = makeSecretReference({ name: 'redis-url', envVar: 'REDIS_URL' });
    expect(ref.name).toBe('redis-url');
    expect(ref.envVar).toBe('REDIS_URL');
  });
});

describe('makeEnvironment', () => {
  it('should return defaults', () => {
    const env = makeEnvironment();
    expect(env.name).toBe('staging');
    expect(env.url).toBe('https://staging.cashtrace.ng');
    expect(env.variables).toHaveLength(1);
    expect(env.secrets).toHaveLength(1);
    expect(env.autoDeployBranch).toBe('main');
    expect(env.requiresApproval).toBe(false);
  });

  it('should accept overrides for production', () => {
    const env = makeEnvironment({
      name: 'production',
      url: 'https://cashtrace.ng',
      requiresApproval: true,
      autoDeployBranch: undefined,
    });
    expect(env.name).toBe('production');
    expect(env.requiresApproval).toBe(true);
    expect(env.autoDeployBranch).toBeUndefined();
  });
});

describe('makeDeploymentStrategy', () => {
  it('should return defaults', () => {
    const strategy = makeDeploymentStrategy();
    expect(strategy.type).toBe('blue_green');
    expect(strategy.healthCheckPath).toBe('/api/health');
    expect(strategy.healthCheckTimeout).toBe(30);
  });

  it('should accept overrides', () => {
    const strategy = makeDeploymentStrategy({ type: 'canary', canaryPercentage: 10 });
    expect(strategy.type).toBe('canary');
    expect(strategy.canaryPercentage).toBe(10);
  });
});

describe('makeRollbackConfig', () => {
  it('should return defaults', () => {
    const config = makeRollbackConfig();
    expect(config.automatic).toBe(true);
    expect(config.healthCheckFailures).toBe(3);
    expect(config.rollbackTimeout).toBe(300);
  });

  it('should accept overrides', () => {
    const config = makeRollbackConfig({ automatic: false, rollbackTimeout: 600 });
    expect(config.automatic).toBe(false);
    expect(config.rollbackTimeout).toBe(600);
  });
});

describe('makeApprovalGate', () => {
  it('should return defaults', () => {
    const gate = makeApprovalGate();
    expect(gate.environment).toBe('production');
    expect(gate.approvers).toEqual(['tech-lead', 'devops-team']);
    expect(gate.timeoutHours).toBe(24);
  });

  it('should accept overrides', () => {
    const gate = makeApprovalGate({ environment: 'staging', timeoutHours: 4 });
    expect(gate.environment).toBe('staging');
    expect(gate.timeoutHours).toBe(4);
  });
});

describe('makeCDPipeline', () => {
  it('should return defaults', () => {
    const pipeline = makeCDPipeline();
    expect(pipeline.environments).toHaveLength(1);
    expect(pipeline.deploymentStrategy.type).toBe('blue_green');
    expect(pipeline.approvals).toHaveLength(1);
    expect(pipeline.rollback.automatic).toBe(true);
  });

  it('should accept overrides', () => {
    const pipeline = makeCDPipeline({
      deploymentStrategy: { type: 'rolling', maxUnavailable: 1 },
    });
    expect(pipeline.deploymentStrategy.type).toBe('rolling');
    expect(pipeline.deploymentStrategy.maxUnavailable).toBe(1);
  });
});

// ─── Infrastructure Factories ────────────────────────────────────────────────

describe('makeAutoScalingConfig', () => {
  it('should return defaults', () => {
    const config = makeAutoScalingConfig();
    expect(config.minReplicas).toBe(2);
    expect(config.maxReplicas).toBe(10);
    expect(config.targetCPU).toBe(70);
    expect(config.targetMemory).toBe(80);
    expect(config.scaleDownDelay).toBe(300);
  });

  it('should accept overrides', () => {
    const config = makeAutoScalingConfig({ minReplicas: 1, maxReplicas: 5 });
    expect(config.minReplicas).toBe(1);
    expect(config.maxReplicas).toBe(5);
  });
});

describe('makeResourceConfig', () => {
  it('should return defaults', () => {
    const resource = makeResourceConfig();
    expect(resource.type).toBe('compute');
    expect(resource.name).toBe('cashtrace-api');
    expect(resource.size).toBe('t3.medium');
    expect(resource.replicas).toBe(2);
  });

  it('should accept overrides', () => {
    const resource = makeResourceConfig({
      type: 'database',
      name: 'cashtrace-db',
      size: 'db.r6g.large',
    });
    expect(resource.type).toBe('database');
    expect(resource.name).toBe('cashtrace-db');
    expect(resource.size).toBe('db.r6g.large');
  });
});

describe('makeNetworkConfig', () => {
  it('should return defaults for Africa region', () => {
    const network = makeNetworkConfig();
    expect(network.vpcCidr).toBe('10.0.0.0/16');
    expect(network.publicSubnets).toHaveLength(2);
    expect(network.privateSubnets).toHaveLength(2);
    expect(network.availabilityZones).toEqual(['af-south-1a', 'af-south-1b']);
  });

  it('should accept overrides', () => {
    const network = makeNetworkConfig({ vpcCidr: '172.16.0.0/16' });
    expect(network.vpcCidr).toBe('172.16.0.0/16');
  });
});

describe('makeSecurityConfig', () => {
  it('should return defaults', () => {
    const security = makeSecurityConfig();
    expect(security.wafEnabled).toBe(true);
    expect(security.sshAllowedCidrs).toEqual(['10.0.0.0/8']);
    expect(security.flowLogsEnabled).toBe(true);
  });

  it('should accept overrides', () => {
    const security = makeSecurityConfig({ wafEnabled: false });
    expect(security.wafEnabled).toBe(false);
  });
});

describe('makeInfrastructureConfig', () => {
  it('should return defaults for AWS Africa', () => {
    const infra = makeInfrastructureConfig();
    expect(infra.provider).toBe('aws');
    expect(infra.region).toBe('af-south-1');
    expect(infra.resources).toHaveLength(1);
    expect(infra.networking.vpcCidr).toBe('10.0.0.0/16');
    expect(infra.security.wafEnabled).toBe(true);
  });

  it('should accept overrides', () => {
    const infra = makeInfrastructureConfig({ region: 'eu-west-1' });
    expect(infra.region).toBe('eu-west-1');
    expect(infra.provider).toBe('aws');
  });
});

// ─── Secret Management Factories ─────────────────────────────────────────────

describe('makeSecretMetadata', () => {
  it('should return defaults', () => {
    const meta = makeSecretMetadata();
    expect(meta.name).toBe('database-url');
    expect(meta.version).toBe('v1');
    expect(meta.createdAt).toBeInstanceOf(Date);
    expect(meta.rotatedAt).toBeInstanceOf(Date);
    expect(meta.expiresAt).toBeUndefined();
  });

  it('should accept overrides', () => {
    const expires = new Date(Date.now() + 86_400_000);
    const meta = makeSecretMetadata({ name: 'api-key', expiresAt: expires });
    expect(meta.name).toBe('api-key');
    expect(meta.expiresAt).toBe(expires);
  });
});

describe('makeSecretAccessLog', () => {
  it('should return defaults', () => {
    const log = makeSecretAccessLog();
    expect(log.timestamp).toBeInstanceOf(Date);
    expect(log.principal).toContain('arn:aws:iam');
    expect(log.action).toBe('read');
    expect(log.success).toBe(true);
  });

  it('should accept overrides', () => {
    const log = makeSecretAccessLog({ action: 'rotate', success: false });
    expect(log.action).toBe('rotate');
    expect(log.success).toBe(false);
  });
});

// ─── Deployment Factories ────────────────────────────────────────────────────

describe('makeHealthCheckResult', () => {
  it('should return defaults', () => {
    const check = makeHealthCheckResult();
    expect(check.timestamp).toBeInstanceOf(Date);
    expect(check.endpoint).toBe('/api/health');
    expect(check.status).toBe(200);
    expect(check.latency).toBe(45);
    expect(check.healthy).toBe(true);
  });

  it('should accept overrides for unhealthy check', () => {
    const check = makeHealthCheckResult({ status: 503, healthy: false, latency: 5000 });
    expect(check.status).toBe(503);
    expect(check.healthy).toBe(false);
    expect(check.latency).toBe(5000);
  });
});

describe('makeDeployment', () => {
  it('should return defaults', () => {
    const deploy = makeDeployment();
    expect(deploy.id).toBeTruthy();
    expect(deploy.environment).toBe('staging');
    expect(deploy.version).toBe('1.2.3');
    expect(deploy.commitSha).toBe('abc1234def5678');
    expect(deploy.status).toBe('succeeded');
    expect(deploy.strategy.type).toBe('blue_green');
    expect(deploy.startedAt).toBeInstanceOf(Date);
    expect(deploy.initiatedBy).toBe('ci-bot');
    expect(deploy.healthChecks).toHaveLength(1);
    expect(deploy.completedAt).toBeUndefined();
    expect(deploy.approvedBy).toBeUndefined();
    expect(deploy.rollbackOf).toBeUndefined();
  });

  it('should accept overrides for production rollback', () => {
    const deploy = makeDeployment({
      environment: 'production',
      status: 'rolled_back',
      approvedBy: 'tech-lead',
      rollbackOf: 'deploy-123',
    });
    expect(deploy.environment).toBe('production');
    expect(deploy.status).toBe('rolled_back');
    expect(deploy.approvedBy).toBe('tech-lead');
    expect(deploy.rollbackOf).toBe('deploy-123');
  });
});
