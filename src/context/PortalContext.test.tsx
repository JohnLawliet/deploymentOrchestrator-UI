import { describe, expect, it } from 'vitest';
import {
  buildActivityMapsFromSnapshot,
  isFrontendWarningEvent,
  jarResourceKeyForReconciliation,
  mapFrontendProfiles,
  mergeActivityMap,
  mergeOperationEventRecord,
  reconcileOperationsWithSnapshot,
} from './PortalContext';
import { frontendProfileActivity, jarProfileActivity, systemEvent, wildflyProfileActivity } from '../test/factories';
import type { SystemSnapshot } from '@/types/api-contracts';
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

describe('lifecycle activity reduction', () => {
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
        hasBackup: true,
        backupSnapshotId: 1,
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
      hasBackup: true,
      backupSnapshotId: 1,
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

  it('drops stale nonterminal operation progress while retaining active and terminal records', () => {
    const operations = {
      active: operationRecord({ deploymentId: 'active', registered: true }),
      stale: operationRecord({ deploymentId: 'stale', registered: true }),
      terminal: operationRecord({ deploymentId: 'terminal', statusEvent: 'DEPLOYMENT_SUCCEEDED' }),
    };
    expect(
      reconcileOperationsWithSnapshot(
        operations,
        systemSnapshot({
          wildflyProfiles: [wildflyProfileActivity({ activeOperationId: 'active' })],
        }),
      ),
    ).toEqual({ active: operations.active, terminal: operations.terminal });
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
