import { describe, expect, it } from 'vitest';
import {
  applyFrontendAssociationUpdate,
  buildActivityMapsFromSnapshot,
  isFrontendWarningEvent,
  jarResourceKeyForReconciliation,
  mapFrontendProfiles,
  mergeActivityMap,
  mergeOperationEventRecord,
  isOwnedOperationEvent,
  parseSseEvent,
  reconcileOperationsWithSnapshot,
  reconcileViewingOperationWithSnapshot,
} from './PortalContext';
import { finishRegisteredOperationOnLifecycle } from '@/lib/operationProgress';
import { frontendProfileActivity, jarProfileActivity, systemEvent, wildflyProfileActivity } from '../test/factories';
import type { SystemEvent, SystemSnapshot } from '@/types/api-contracts';
import type { OperationRecord } from '@/types/frontend';

const profile = wildflyProfileActivity({
  id: 'profile-1',
  status: 'DEPLOYING',
  activeOperationId: 'deployment-1',
  failedDeployCount: 2,
});

const systemSnapshot = (overrides: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  wildflyProfiles: [],
  jarProfiles: [],
  frontendProfiles: [],
  onlineUsers: [],
  locks: [],
  ...overrides,
});

const operationRecord = (overrides: Partial<OperationRecord> = {}): OperationRecord => ({
  deploymentId: 'deployment-test',
  ...overrides,
});

describe('operation event ownership', () => {
  const event = (deploymentId: string, username: string | null) => ({ deploymentId, username });

  it('accepts current-user progress, rejects another user, and falls back only to a locally accepted operation', () => {
    const operations = {
      local: operationRecord({ deploymentId: 'local', initiatedByCurrentSession: true }),
      remote: operationRecord({ deploymentId: 'remote' }),
    };

    expect(isOwnedOperationEvent(event('any', 'Alice'), 'alice', operations)).toBe(true);
    expect(isOwnedOperationEvent(event('local', 'Bob'), 'alice', operations)).toBe(false);
    expect(isOwnedOperationEvent(event('local', null), 'alice', operations)).toBe(true);
    expect(isOwnedOperationEvent(event('remote', null), 'alice', operations)).toBe(false);
  });
});

describe('lifecycle activity reduction', () => {
  it('retains the recovered active state for an automatic rollback operation', () => {
    const record = mergeOperationEventRecord(
      operationRecord({
        deploymentId: 'deployment-1',
        progress: { rollbackState: 'RESTORING' } as OperationRecord['progress'],
      }),
      systemEvent({
        eventType: 'RESOURCE_ACTIVE',
        deploymentId: 'deployment-1',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
        state: 'ACTIVE',
        resources: null,
      }),
    );

    expect(record).toMatchObject({ restoredResourceState: 'ACTIVE', state: 'ACTIVE' });
  });

  it('marks WildFly server logs available without attaching a terminal', () => {
    const initial = {
      'profile-1': profile,
      'profile-2': wildflyProfileActivity({ id: 'profile-2', activeOperationId: null }),
    };
    const reduced = mergeActivityMap(
      initial,
      systemEvent({
        eventType: 'TERMINAL_AVAILABLE',
        deploymentId: 'deployment-2',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
        resources: null,
      }),
    );

    expect(reduced['profile-1'].activeOperationId).toBe('deployment-1');
    expect(reduced['profile-1'].serverLogAvailable).toBe(true);
    expect(reduced['profile-2'].activeOperationId).toBeNull();
    expect(
      mergeActivityMap(
        {},
        systemEvent({
          eventType: 'TERMINAL_AVAILABLE',
          deploymentId: 'deployment-2',
          resourceKey: 'WILDFLY_PROFILE:missing',
          resources: null,
        }),
      ),
    ).toEqual({
      missing: { id: 'missing', serverLogAvailable: true },
    });
  });

  it('attaches and closes terminals only for JAR resources', () => {
    const jar = { 'jar-1': jarProfileActivity({ id: 'jar-1', activeOperationId: null }) };
    const attached = mergeActivityMap(
      jar,
      systemEvent({
        eventType: 'TERMINAL_AVAILABLE',
        resourceType: 'JAR',
        deploymentId: 'deployment-2',
        resourceKey: 'JAR:jar-1',
        resources: null,
      }),
    );
    expect(attached['jar-1']).toMatchObject({ terminalDeploymentId: 'deployment-2', terminalAvailable: true });
    const replaced = mergeActivityMap(
      attached,
      systemEvent({
        eventType: 'TERMINAL_AVAILABLE',
        resourceType: 'JAR',
        deploymentId: 'deployment-3',
        resourceKey: 'JAR:jar-1',
        resources: null,
      }),
    );
    expect(replaced['jar-1']).toMatchObject({ terminalDeploymentId: 'deployment-3', terminalAvailable: true });
    expect(
      mergeActivityMap(
        replaced,
        systemEvent({
          eventType: 'RESOURCE_INACTIVE',
          resourceType: 'JAR',
          resourceKey: 'JAR:jar-1',
          resources: null,
        }),
      )['jar-1'].terminalDeploymentId,
    ).toBe('deployment-3');
    expect(
      mergeActivityMap(
        attached,
        systemEvent({
          eventType: 'TERMINAL_CLOSED',
          resourceType: 'JAR',
          deploymentId: 'deployment-2',
          resourceKey: 'JAR:jar-1',
          resources: null,
        }),
      )['jar-1'].terminalAvailable,
    ).toBe(false);
  });

  it('retains terminal availability after failure while applying the final recovered state', () => {
    const reduced = mergeActivityMap(
      { 'profile-1': profile },
      systemEvent({
        eventType: 'DEPLOYMENT_FAILED',
        deploymentId: 'deployment-1',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
        resourceType: 'WILDFLY_PROFILE',
        state: 'ACTIVE',
        pid: 4210,
        activeOperationId: null,
        deployCount: 8,
        failedDeployCount: 3,
        consecutiveFailures: 1,
        lastResult: 'FAILED',
        timestamp: '2026-07-28T10:00:00Z',
        resources: null,
      }),
    );

    expect(reduced['profile-1']).toMatchObject({
      status: 'ACTIVE',
      pid: 4210,
      activeOperationId: null,
      deployCount: 8,
      failedDeployCount: 3,
      consecutiveFailures: 1,
      lastResult: 'FAILED',
    });
  });

  it('does not treat a WildFly terminal close as profile-log state', () => {
    const retained = { 'profile-1': wildflyProfileActivity({ ...profile, status: 'ACTIVE', lastResult: 'FAILED' }) };
    expect(
      mergeActivityMap(
        retained,
        systemEvent({
          eventType: 'TERMINAL_CLOSED',
          deploymentId: 'deployment-1',
          resourceKey: 'WILDFLY_PROFILE:profile-1',
          resources: null,
        }),
      )['profile-1'].activeOperationId,
    ).toBe('deployment-1');

    expect(
      mergeActivityMap(
        retained,
        systemEvent({
          eventType: 'TERMINAL_CLOSED',
          deploymentId: 'another-deployment',
          resourceKey: 'WILDFLY_PROFILE:profile-1',
          resources: null,
        }),
      )['profile-1'].activeOperationId,
    ).toBe('deployment-1');
  });

  it('marks profile logs unavailable using a direct profile ID', () => {
    expect(
      mergeActivityMap(
        { 'profile-1': { ...profile, serverLogAvailable: true } },
        systemEvent({
          eventType: 'PROFILE_LOG_UNAVAILABLE',
          resourceKey: 'WILDFLY_PROFILE:profile-1',
          resourceType: 'WILDFLY_PROFILE',
          resources: null,
        }),
      )['profile-1'].serverLogAvailable,
    ).toBe(false);
  });

  it('can rebuild a missing profile row from a lifecycle resource key', () => {
    expect(
      mergeActivityMap(
        {},
        systemEvent({
          eventType: 'DEPLOYMENT_FAILED',
          resourceKey: 'WILDFLY_PROFILE:profile-2',
          state: 'INACTIVE',
          activeOperationId: null,
          lastResult: 'FAILED',
          resources: null,
        }),
      ),
    ).toEqual({
      'profile-2': expect.objectContaining({
        id: 'profile-2',
        status: 'INACTIVE',
        activeOperationId: null,
        lastResult: 'FAILED',
      }),
    });
  });
});

describe('frontend profile system events', () => {
  it('builds the SYSTEM_SNAPSHOT frontend cache by profile UUID', () => {
    const orders = frontendProfileActivity({ profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 });
    const payments = frontendProfileActivity({ profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 });
    expect(mapFrontendProfiles([orders, payments])).toEqual({
      'frontend-1': orders,
      'frontend-2': payments,
    });
  });

  it('parses and idempotently applies a frontend association update by frontend UUID and JAR ID', () => {
    const frontend = frontendProfileActivity({ profileUuid: 'frontend-2', profileName: 'payments-ui', jarProfileUuid: 'jar-2' });
    const nestedFrontend = frontendProfileActivity({ ...frontend, profileName: 'nested-payments-ui' });
    const jar = jarProfileActivity({
      id: 'jar-2',
      applicationName: 'payments',
      frontendProfileUuid: 'frontend-2',
      frontendProfile: nestedFrontend,
    });
    const event = parseSseEvent({
      id: '',
      event: 'FRONTEND_ASSOCIATION_UPDATED',
      data: JSON.stringify(
        systemEvent({
          eventType: 'FRONTEND_ASSOCIATION_UPDATED',
          deploymentId: 'deployment-2',
          resources: {
            deploymentId: 'deployment-2',
            jarProfileUuid: 'jar-2',
            frontendProfileUuid: 'frontend-2',
            frontendProfile: frontend,
            jarProfile: jar,
          },
        }),
      ),
    });
    expect(event).toEqual(expect.objectContaining({ eventType: 'FRONTEND_ASSOCIATION_UPDATED', scope: 'SYSTEM' }));
    if (!event || !('eventType' in event) || event.eventType !== 'FRONTEND_ASSOCIATION_UPDATED') return;
    const current = {
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: { unrelated: jarProfileActivity({ id: 'unrelated' }) },
      frontendProfileActivityMap: { 'frontend-1': frontendProfileActivity({ profileUuid: 'frontend-1' }) },
    };
    const applied = applyFrontendAssociationUpdate(current, event);
    expect(applied.frontendProfileActivityMap).toEqual({ 'frontend-1': expect.anything(), 'frontend-2': frontend });
    expect(applied.jarProfileActivityMap).toMatchObject({ unrelated: { id: 'unrelated' }, 'jar-2': { id: 'jar-2' } });
    expect(applied.jarProfileActivityMap['jar-2'].frontendProfile).toBe(event.resources.jarProfile.frontendProfile);
    expect(applyFrontendAssociationUpdate(applied, event)).toBe(applied);
  });

  it('rejects malformed frontend association updates', () => {
    const event = systemEvent<Extract<SystemEvent, { eventType: 'FRONTEND_ASSOCIATION_UPDATED' }>>({
      eventType: 'FRONTEND_ASSOCIATION_UPDATED',
      resources: {
        deploymentId: 'deployment-2',
        jarProfileUuid: 'jar-2',
        frontendProfileUuid: 'frontend-2',
        frontendProfile: frontendProfileActivity(),
        jarProfile: jarProfileActivity(),
      },
    });
    const malformed = { ...event, resources: { ...event.resources, frontendProfile: { profileUuid: 'frontend-2' } } };
    expect(parseSseEvent({ id: '', event: 'FRONTEND_ASSOCIATION_UPDATED', data: JSON.stringify(malformed) })).toBeNull();
  });

  it('accepts a backend SYSTEM_SNAPSHOT without backup fields and caches frontend profiles', () => {
    const event = parseSseEvent({
      id: '',
      event: 'SYSTEM_SNAPSHOT',
      data: JSON.stringify({
        eventType: 'SYSTEM_SNAPSHOT',
        scope: 'SYSTEM',
        timestamp: '2026-08-12T10:00:00Z',
        deploymentId: null,
        resourceKey: null,
        resourceType: null,
        state: null,
        pid: null,
        activeOperationId: null,
        deployCount: null,
        consecutiveFailures: null,
        failedDeployCount: null,
        lastResult: null,
        username: null,
        message: 'Current QC resource state',
        application: null,
        readiness: null,
        readinessReason: null,
        resources: {
          wildflyProfiles: [],
          jarProfiles: [],
          frontendProfiles: [
            {
              profileUuid: 'frontend-1',
              profileName: 'orders-ui',
              port: 3000,
              documentRoot: '/srv/www/orders',
              serverName: 'orders.example',
              frontendUrl: 'https://orders.example',
              jarProfileUuid: null,
              applicationName: null,
              jarName: null,
              lastDeployedUser: null,
              lastDeploymentOn: null,
              health: 'FUNCTIONAL',
              healthReason: null,
              directoryExists: true,
              running: true,
            },
          ],
          onlineUsers: [],
          locks: [],
        },
      }),
    });
    expect(event && 'eventType' in event && event.eventType === 'SYSTEM_SNAPSHOT').toBe(true);
    if (!event || !('eventType' in event) || event.eventType !== 'SYSTEM_SNAPSHOT') return;
    expect(buildActivityMapsFromSnapshot(event.resources).frontendProfileActivityMap).toEqual({
      'frontend-1': expect.objectContaining({ profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 }),
    });
  });

  it('requires a valid SSE scope and accepts reconciliation SYSTEM events', () => {
    const event = (scope: string | undefined, eventType: string, resources: unknown) =>
      parseSseEvent({
        id: '',
        event: eventType,
        data: JSON.stringify({
          timestamp: '2026-08-12T10:00:00Z',
          ...(scope === undefined ? {} : { scope }),
          eventType,
          deploymentId: null,
          resourceKey: null,
          resourceType: null,
          state: null,
          pid: null,
          activeOperationId: null,
          deployCount: null,
          consecutiveFailures: null,
          failedDeployCount: null,
          lastResult: null,
          username: null,
          message: 'Runtime reconciliation found issues.',
          application: null,
          readiness: null,
          readinessReason: null,
          resources,
        }),
      });

    expect(event(undefined, 'RUNTIME_RECONCILIATION_ISSUES', [])).toBeNull();
    expect(event('INVALID', 'RUNTIME_RECONCILIATION_ISSUES', [])).toBeNull();
    expect(event('SYSTEM', 'RUNTIME_RECONCILIATION_ISSUES', [])).toEqual(
      expect.objectContaining({ eventType: 'RUNTIME_RECONCILIATION_ISSUES', scope: 'SYSTEM' }),
    );
    expect(event('SYSTEM', 'RUNTIME_RECONCILIATION_RECOVERED', null)).toEqual(
      expect.objectContaining({ eventType: 'RUNTIME_RECONCILIATION_RECOVERED', scope: 'SYSTEM' }),
    );
  });

  it('clears frontend profiles when SYSTEM_SNAPSHOT includes an explicit empty frontendProfiles array', () => {
    const currentMaps = {
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {},
      frontendProfileActivityMap: {
        'frontend-1': frontendProfileActivity({ profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 }),
      },
    };
    expect(
      buildActivityMapsFromSnapshot(
        systemSnapshot({
          jarProfiles: [jarProfileActivity({ id: 'orders', applicationName: 'Orders', status: 'ACTIVE' })],
          frontendProfiles: [],
        }),
        currentMaps,
      ),
    ).toEqual({
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {
        orders: expect.objectContaining({ id: 'orders', applicationName: 'Orders', status: 'ACTIVE' }),
      },
      frontendProfileActivityMap: {},
    });
  });

  it('replaces frontend profiles when SYSTEM_SNAPSHOT includes an explicit frontendProfiles array', () => {
    expect(
      buildActivityMapsFromSnapshot(
        systemSnapshot({
          frontendProfiles: [frontendProfileActivity({ profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 })],
        }),
        {
          frontendProfileActivityMap: {
            'frontend-1': frontendProfileActivity({ profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 }),
          },
        },
      ).frontendProfileActivityMap,
    ).toEqual({
      'frontend-2': expect.objectContaining({ profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 }),
    });
  });

  it('drops unregistered nonterminal progress while retaining active, terminal, and registered in-flight records', () => {
    const operations = {
      active: operationRecord({ deploymentId: 'active', registered: true }),
      stale: operationRecord({ deploymentId: 'stale' }),
      pending: operationRecord({ deploymentId: 'pending', registered: true, status: 'STARTING' }),
      terminal: operationRecord({ deploymentId: 'terminal', statusEvent: 'DEPLOYMENT_SUCCEEDED' }),
    };
    expect(
      reconcileOperationsWithSnapshot(
        operations,
        systemSnapshot({
          wildflyProfiles: [wildflyProfileActivity({ activeOperationId: 'active' })],
        }),
      ),
    ).toEqual({
      active: operations.active,
      pending: operations.pending,
      terminal: operations.terminal,
    });
  });

  it('keeps a just-registered WAR operation and viewing panel across an early SYSTEM_SNAPSHOT', () => {
    const warOp = operationRecord({
      deploymentId: 'war-deploy-1',
      registered: true,
      operationType: 'WAR_DEPLOY',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      status: 'STARTING',
      label: 'Deploy WAR · orders',
    });
    const operations = { 'war-deploy-1': warOp };
    const snapshot = systemSnapshot({
      wildflyProfiles: [wildflyProfileActivity({ id: 'profile-1', activeOperationId: null })],
    });
    const reconciled = reconcileOperationsWithSnapshot(operations, snapshot);
    expect(reconciled).toEqual({ 'war-deploy-1': warOp });

    const activeIds = new Set(
      [...snapshot.wildflyProfiles, ...snapshot.jarProfiles]
        .map((activity) => activity.activeOperationId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const terminalIds = new Set<string>();
    expect(reconcileViewingOperationWithSnapshot(warOp, activeIds, terminalIds, reconciled)).toBe(warOp);
  });

  it('still clears JAR viewing when the snapshot does not yet list the deployment', () => {
    const jarOp = operationRecord({
      deploymentId: 'jar-deploy-1',
      registered: true,
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
      status: 'STARTING',
    });
    expect(reconcileViewingOperationWithSnapshot(jarOp, new Set(), new Set(), { 'jar-deploy-1': jarOp })).toBeNull();
  });

  it.each(['FRONTEND_PROFILE_UNRESOLVED', 'FRONTEND_INACTIVE', 'FRONTEND_CONFIGURATION_INVALID'] as const)(
    'treats %s as a non-blocking frontend warning',
    (eventType) => {
      expect(isFrontendWarningEvent(eventType)).toBe(true);
      expect(
        mergeOperationEventRecord(
          operationRecord({ statusEvent: 'DEPLOYMENT_SUCCEEDED' }),
          systemEvent({
            eventType,
            deploymentId: 'deployment-1',
            message: 'Frontend warning',
            resources: 'Frontend warning',
          }),
        ),
      ).toMatchObject({
        deploymentId: 'deployment-1',
        statusEvent: 'DEPLOYMENT_SUCCEEDED',
        frontendWarning: 'Frontend warning',
      });
    },
  );

  it('refreshes JAR data after terminal deployment and restart lifecycle events', () => {
    expect(
      jarResourceKeyForReconciliation(
        systemEvent({
          eventType: 'DEPLOYMENT_SUCCEEDED',
          resourceType: 'JAR',
          resourceKey: 'JAR:orders',
          resources: null,
        }),
      ),
    ).toBe('JAR:orders');
    expect(
      jarResourceKeyForReconciliation(
        systemEvent({
          eventType: 'RESOURCE_ACTIVE',
          resourceType: 'JAR',
          resourceKey: 'JAR:orders',
          resources: null,
        }),
      ),
    ).toBe('JAR:orders');
    expect(
      jarResourceKeyForReconciliation(
        systemEvent({
          eventType: 'RESOURCE_STARTING',
          resourceType: 'JAR',
          resourceKey: 'JAR:orders',
          resources: null,
        }),
      ),
    ).toBeNull();
    expect(
      jarResourceKeyForReconciliation(
        systemEvent({
          eventType: 'RESOURCE_ACTIVE',
          resourceType: 'WILDFLY_PROFILE',
          resourceKey: 'WILDFLY_PROFILE:orders',
          resources: null,
        }),
      ),
    ).toBeNull();
  });

  it('completes a registered JAR restart when RESOURCE_ACTIVE omits deploymentId', () => {
    const operations = {
      'restart-1': operationRecord({
        deploymentId: 'restart-1',
        registered: true,
        resourceType: 'JAR',
        resourceKey: 'JAR:vendor-portal',
        progress: {
          phaseCode: 'RESTARTING',
          status: 'RESTARTING',
          progressPercentage: 60,
          component: null,
          message: 'Restarting',
          timestamp: '2026-08-14T00:00:00Z',
          resourceKey: 'JAR:vendor-portal',
          resourceType: 'JAR',
          username: null,
          firstReceivedAt: 1,
          receivedAt: 1,
          revision: 1,
          eventKeys: [],
          steps: [],
        },
      }),
    };

    expect(
      finishRegisteredOperationOnLifecycle(operations, {
        eventType: 'RESOURCE_ACTIVE',
        deploymentId: null,
        resourceKey: 'JAR:vendor-portal',
        resourceType: 'JAR',
        message: 'Application is active',
      })['restart-1']?.progress,
    ).toMatchObject({
      progressPercentage: 100,
      deploymentOutcome: 'SUCCEEDED',
      status: 'COMPLETED',
    });
  });

  it('completes a registered WAR profile start when RESOURCE_ACTIVE omits deploymentId', () => {
    const operations = {
      'start-1': operationRecord({
        deploymentId: 'start-1',
        registered: true,
        resourceType: 'WILDFLY_PROFILE',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
      }),
    };

    expect(
      finishRegisteredOperationOnLifecycle(operations, {
        eventType: 'RESOURCE_ACTIVE',
        deploymentId: null,
        resourceKey: 'WILDFLY_PROFILE:profile-1',
        resourceType: 'WILDFLY_PROFILE',
        message: 'Profile is active',
      })['start-1']?.progress,
    ).toMatchObject({
      progressPercentage: 100,
      deploymentOutcome: 'SUCCEEDED',
      status: 'COMPLETED',
    });
  });
});

describe('operation terminal availability', () => {
  it('keeps the terminal failure status and message when its JAR log becomes available', () => {
    const failed = mergeOperationEventRecord(
      undefined,
      systemEvent({
        eventType: 'DEPLOYMENT_FAILED',
        deploymentId: 'deployment-1',
        resourceType: 'JAR',
        message: 'The launcher exited before startup completed.',
        resources: null,
      }),
    );
    const available = mergeOperationEventRecord(
      failed,
      systemEvent({
        eventType: 'DEPLOYMENT_LOG_AVAILABLE',
        deploymentId: 'deployment-1',
        resourceType: 'JAR',
        message: 'A deployment log is available.',
        resources: null,
      }),
    );

    expect(available).toMatchObject({
      statusEvent: 'DEPLOYMENT_FAILED',
      message: 'The launcher exited before startup completed.',
      logAvailable: true,
    });
  });

  it('changes terminal availability only from matching lifecycle events', () => {
    const responseRecord = operationRecord({
      deploymentId: 'deployment-1',
      terminalEventsUrl: '/api/terminals/deployment-1/events',
    });
    const available = mergeOperationEventRecord(
      responseRecord,
      systemEvent({
        eventType: 'TERMINAL_AVAILABLE',
        deploymentId: 'deployment-1',
        resourceType: 'JAR',
        resourceKey: 'JAR:orders',
        resources: null,
      }),
    );

    expect(available.terminalAvailabilityConfirmed).toBe(true);
    expect(
      mergeOperationEventRecord(
        available,
        systemEvent({
          eventType: 'OPERATION_PROGRESS',
          deploymentId: 'deployment-1',
          resources: { phaseCode: 'TEST', status: 'RUNNING', progressPercentage: null, component: null },
        }),
      ).terminalAvailabilityConfirmed,
    ).toBe(true);
    expect(
      mergeOperationEventRecord(
        available,
        systemEvent({
          eventType: 'TERMINAL_CLOSED',
          deploymentId: 'deployment-1',
          resourceType: 'JAR',
          resourceKey: 'JAR:orders',
          resources: null,
        }),
      ).terminalAvailabilityConfirmed,
    ).toBe(false);
  });
});
