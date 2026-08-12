import { describe, expect, it } from 'vitest';
import {
  applyOperationFinished,
  parseOperationProgressData,
  reduceOperationProgress,
  registerOperationInMap,
} from './operationProgress';
import { systemEvent } from '@/test/factories';
import type { SystemEvent } from '@/types/api-contracts';

type ProgressEvent = Extract<SystemEvent, { eventType: 'OPERATION_PROGRESS' }>;

const progressEvent = (deploymentId: string): ProgressEvent =>
  systemEvent<ProgressEvent>({
    eventType: 'OPERATION_PROGRESS',
    timestamp: '2026-07-28T10:00:00Z',
    deploymentId,
    resourceKey: 'WILDFLY_PROFILE:profile-1',
    resourceType: 'WILDFLY_PROFILE',
    username: 'deploy-user',
    message: 'Deploying',
    resources: { phaseCode: 'DEPLOY', status: 'DEPLOYING', progressPercentage: 50, component: 'WildFly' },
  });

describe('operation progress canonical correlation', () => {
  it('keys canonical progress and registration by deploymentId', () => {
    const event = progressEvent('deployment-1');
    const resourceKey = 'WILDFLY_PROFILE:profile-1';
    const parsed = parseOperationProgressData(JSON.stringify(event));
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Expected a valid operation-progress event.');
    const progressed = reduceOperationProgress({}, parsed);
    const registered = registerOperationInMap(progressed, { deploymentId: 'deployment-1' }, resourceKey, 'Deploy');

    expect(Object.keys(registered)).toEqual(['deployment-1']);
    expect(registered['deployment-1']).toMatchObject({
      deploymentId: 'deployment-1',
      registered: true,
      progress: { phaseCode: 'DEPLOY', progressPercentage: 50 },
    });
  });

  it('preserves event-confirmed terminal availability when registration arrives later', () => {
    const registered = registerOperationInMap(
      {
        'deployment-1': {
          deploymentId: 'deployment-1',
          terminalAvailabilityConfirmed: true,
        },
      },
      {
        deploymentId: 'deployment-1',
        terminalAvailabilityConfirmed: false,
        terminalEventsUrl: '/api/terminals/deployment-1/events',
      },
      'JAR:orders',
      'Deploy JAR',
    );

    expect(registered['deployment-1']?.terminalAvailabilityConfirmed).toBe(true);
  });

  it('requires a JAR log availability event instead of trusting the operation response', () => {
    const unconfirmed = registerOperationInMap(
      {},
      { deploymentId: 'deployment-1', resourceType: 'JAR', logAvailable: true },
      'JAR:orders',
      'Deploy JAR',
    );
    const confirmed = registerOperationInMap(
      { 'deployment-1': { deploymentId: 'deployment-1', logAvailable: true } },
      { deploymentId: 'deployment-1', resourceType: 'JAR', logAvailable: false },
      'JAR:orders',
      'Deploy JAR',
    );

    expect(unconfirmed['deployment-1']).not.toHaveProperty('logAvailable');
    expect(confirmed['deployment-1']?.logAvailable).toBe(true);
  });

  it('retains whether a registered JAR deployment includes frontend publishing as progress arrives', () => {
    const registered = registerOperationInMap(
      {},
      { deploymentId: 'deployment-1', resourceType: 'JAR', operationType: 'JAR_DEPLOY', frontendDeploymentRequested: true },
      'JAR:orders',
      'Deploy JAR · orders + Portal',
    );
    const event = progressEvent('deployment-1');
    event.resourceKey = 'JAR:orders';
    event.resourceType = 'JAR';
    event.resources = { ...event.resources, phaseCode: 'FRONTEND_STAGING', status: 'DEPLOYING', progressPercentage: 20 };

    expect(reduceOperationProgress(registered, event)['deployment-1']).toMatchObject({
      operationType: 'JAR_DEPLOY',
      frontendDeploymentRequested: true,
      progress: { phaseCode: 'FRONTEND_STAGING' },
    });
  });

  it('rejects legacy operationId-only progress events outside the backend SSE contract', () => {
    const legacyEvent = {
      eventType: 'OPERATION_PROGRESS',
      operationId: 'legacy-1',
      resources: { phaseCode: 'DEPLOY', status: 'DEPLOYING', progressPercentage: 50, component: 'WildFly' },
    };

    expect(parseOperationProgressData(JSON.stringify(legacyEvent))).toBeNull();
  });

  it('retains shared progress from another validated user as an unregistered operation', () => {
    const event = progressEvent('shared-deployment');
    event.username = 'another-user';
    event.resourceKey = 'JAR:opaque-uuid';
    event.resourceType = 'JAR';

    expect(reduceOperationProgress({}, event)).toMatchObject({
      'shared-deployment': {
        deploymentId: 'shared-deployment',
        progress: {
          username: 'another-user',
          resourceKey: 'JAR:opaque-uuid',
          resourceType: 'JAR',
        },
      },
    });
  });

  it('locks completed progress at 100 percent and ignores later progress events', () => {
    const completed = progressEvent('deployment-1');
    completed.message = 'Deployment completed.';
    completed.resources = {
      ...completed.resources,
      phaseCode: 'COMPLETE',
      status: 'COMPLETED',
      progressPercentage: 80,
    };
    const terminal = reduceOperationProgress({}, completed);
    const stale = progressEvent('deployment-1');
    stale.timestamp = '2026-07-28T10:01:00Z';
    stale.message = 'Restarting application';
    stale.resources = {
      ...stale.resources,
      phaseCode: 'RESTARTING',
      status: 'RESTARTING',
      progressPercentage: 80,
    };

    expect(terminal['deployment-1']?.progress?.progressPercentage).toBe(100);
    expect(reduceOperationProgress(terminal, stale)).toBe(terminal);
  });

  it('retains the failed deployment result while recording post-failure cleanup progress', () => {
    const failed = progressEvent('deployment-1');
    failed.message = 'Health verification timed out.';
    failed.resources = { ...failed.resources, status: 'FAILED', progressPercentage: 80 };
    const terminal = reduceOperationProgress({}, failed);
    const cleanup = progressEvent('deployment-1');
    cleanup.timestamp = '2026-07-28T10:01:00Z';
    cleanup.message = 'Cleaning up deployment staging.';
    cleanup.resources = { ...cleanup.resources, phaseCode: 'CLEANUP', status: 'FAILED', progressPercentage: 40 };

    const reduced = reduceOperationProgress(terminal, cleanup);
    expect(reduced['deployment-1']?.progress).toMatchObject({
      phaseCode: 'CLEANUP',
      progressPercentage: 80,
      deploymentOutcome: 'FAILED',
      failureMessage: 'Health verification timed out.',
    });
  });

  it('tracks automatic rollback and infers rollback failure from FAILED after rollback begins', () => {
    const rollbackStarted = progressEvent('deployment-1');
    rollbackStarted.resources = {
      ...rollbackStarted.resources,
      phaseCode: 'ROLLBACK_STARTED',
      status: 'RESTARTING',
      progressPercentage: 95,
    };
    rollbackStarted.message = 'WAR deployment failed; starting rollback';
    const restoring = reduceOperationProgress({}, rollbackStarted);

    const rollbackFailed = progressEvent('deployment-1');
    rollbackFailed.timestamp = '2026-07-28T10:01:00Z';
    rollbackFailed.resources = { ...rollbackFailed.resources, phaseCode: 'FAILED', status: 'FAILED', progressPercentage: null };
    rollbackFailed.message = 'WAR deployment failed; ROLLBACK_FAILED: permission denied';
    const failed = reduceOperationProgress(restoring, rollbackFailed);

    expect(failed['deployment-1']?.progress).toMatchObject({
      deploymentOutcome: 'FAILED',
      rollbackState: 'FAILED',
      rollbackFailureMessage: 'WAR deployment failed; ROLLBACK_FAILED: permission denied',
      progressPercentage: 95,
    });
  });

  it('marks manual rollback completion as a successful restoration at 100 percent', () => {
    const started = progressEvent('rollback-1');
    started.resources = { ...started.resources, phaseCode: 'ROLLBACK_STARTED', status: 'PREPARING', progressPercentage: 35 };
    const restoring = reduceOperationProgress({}, started);
    const complete = progressEvent('rollback-1');
    complete.timestamp = '2026-07-28T10:01:00Z';
    complete.resources = { ...complete.resources, phaseCode: 'COMPLETED', status: 'COMPLETED', progressPercentage: 100 };

    expect(reduceOperationProgress(restoring, complete)['rollback-1']?.progress).toMatchObject({
      deploymentOutcome: 'SUCCEEDED',
      rollbackState: 'RESTORED',
      progressPercentage: 100,
    });
  });

  it('applies OPERATION_FINISHED outcomes onto registered progress', () => {
    const registered = registerOperationInMap(
      reduceOperationProgress({}, progressEvent('war-1')),
      { deploymentId: 'war-1', operationType: 'WAR_DEPLOY' },
      'WILDFLY_PROFILE:profile-1',
      'Deploy WAR',
    );

    expect(applyOperationFinished(registered, 'war-1', 'COMPLETED', 'WAR deploy finished')['war-1']).toMatchObject({
      status: 'COMPLETED',
      progress: {
        phaseCode: 'COMPLETED',
        status: 'COMPLETED',
        progressPercentage: 100,
        deploymentOutcome: 'SUCCEEDED',
        message: 'WAR deploy finished',
      },
    });

    expect(applyOperationFinished(registered, 'war-1', 'FAILED', 'boom')['war-1']).toMatchObject({
      status: 'FAILED',
      progress: {
        phaseCode: 'FAILED',
        status: 'FAILED',
        deploymentOutcome: 'FAILED',
        failureMessage: 'boom',
        progressPercentage: 50,
      },
    });

    expect(applyOperationFinished(registered, 'war-1', 'UNKNOWN')).toBe(registered);
  });
});
