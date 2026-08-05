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

const profile = {
  id: 'profile-1',
  status: 'DEPLOYING',
  activeOperationId: 'deployment-1',
  failedDeployCount: 2,
};

describe('lifecycle activity reduction', () => {
  it('marks WildFly server logs available without attaching a terminal', () => {
    const initial = {
      'profile-1': profile,
      'profile-2': { id: 'profile-2', activeOperationId: null },
    };
    const reduced = mergeActivityMap(initial, {
      eventType: 'TERMINAL_AVAILABLE',
      deploymentId: 'deployment-2',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    });

    expect(reduced['profile-1'].activeOperationId).toBe('deployment-1');
    expect(reduced['profile-1'].serverLogAvailable).toBe(true);
    expect(reduced['profile-2'].activeOperationId).toBeNull();
    expect(
      mergeActivityMap(
        {},
        {
          eventType: 'TERMINAL_AVAILABLE',
          deploymentId: 'deployment-2',
          resourceKey: 'WILDFLY_PROFILE:missing',
        },
      ),
    ).toEqual({
      missing: { id: 'missing', serverLogAvailable: true },
    });
  });

  it('attaches and closes terminals only for JAR resources', () => {
    const jar = { 'jar-1': { id: 'jar-1', activeOperationId: null } };
    const attached = mergeActivityMap(jar, {
      eventType: 'TERMINAL_AVAILABLE',
      resourceType: 'JAR',
      deploymentId: 'deployment-2',
      resourceKey: 'JAR:jar-1',
    });
    expect(attached['jar-1']).toMatchObject({ terminalDeploymentId: 'deployment-2', terminalAvailable: true });
    const replaced = mergeActivityMap(attached, {
      eventType: 'TERMINAL_AVAILABLE',
      resourceType: 'JAR',
      deploymentId: 'deployment-3',
      resourceKey: 'JAR:jar-1',
    });
    expect(replaced['jar-1']).toMatchObject({ terminalDeploymentId: 'deployment-3', terminalAvailable: true });
    expect(
      mergeActivityMap(replaced, {
        eventType: 'RESOURCE_INACTIVE',
        resourceType: 'JAR',
        resourceKey: 'JAR:jar-1',
      })['jar-1'].terminalDeploymentId,
    ).toBe('deployment-3');
    expect(
      mergeActivityMap(attached, {
        eventType: 'TERMINAL_CLOSED',
        resourceType: 'JAR',
        deploymentId: 'deployment-2',
        resourceKey: 'JAR:jar-1',
      })['jar-1'].terminalAvailable,
    ).toBe(false);
  });

  it('retains terminal availability after failure while applying the final recovered state', () => {
    const reduced = mergeActivityMap(
      { 'profile-1': profile },
      {
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
        backupSnapshotId: 'snapshot-1',
        timestamp: '2026-07-28T10:00:00Z',
      },
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
      backupSnapshotId: 'snapshot-1',
    });
  });

  it('does not treat a WildFly terminal close as profile-log state', () => {
    const retained = { 'profile-1': { ...profile, status: 'ACTIVE', lastResult: 'FAILED' } };
    expect(
      mergeActivityMap(retained, {
        eventType: 'TERMINAL_CLOSED',
        deploymentId: 'deployment-1',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
      })['profile-1'].activeOperationId,
    ).toBe('deployment-1');

    expect(
      mergeActivityMap(retained, {
        eventType: 'TERMINAL_CLOSED',
        deploymentId: 'another-deployment',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
      })['profile-1'].activeOperationId,
    ).toBe('deployment-1');
  });

  it('marks profile logs unavailable using a direct profile ID', () => {
    expect(
      mergeActivityMap(
        { 'profile-1': { ...profile, serverLogAvailable: true } },
        {
          eventType: 'PROFILE_LOG_UNAVAILABLE',
          profileId: 'profile-1',
          resourceType: 'WILDFLY_PROFILE',
        },
      )['profile-1'].serverLogAvailable,
    ).toBe(false);
  });

  it('can rebuild a missing profile row from a lifecycle resource key', () => {
    expect(
      mergeActivityMap(
        {},
        {
          eventType: 'DEPLOYMENT_FAILED',
          resourceKey: 'WILDFLY_PROFILE:profile-2',
          state: 'INACTIVE',
          activeOperationId: null,
          lastResult: 'FAILED',
        },
      ),
    ).toEqual({
      'profile-2': {
        id: 'profile-2',
        status: 'INACTIVE',
        activeOperationId: null,
        lastResult: 'FAILED',
      },
    });
  });
});

describe('frontend profile system events', () => {
  it('builds the SYSTEM_SNAPSHOT frontend cache by profile UUID', () => {
    expect(
      mapFrontendProfiles([
        { profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 },
        { profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 },
      ]),
    ).toEqual({
      'frontend-1': { profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 },
      'frontend-2': { profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 },
    });
  });

  it('preserves frontend profiles when a partial SYSTEM_SNAPSHOT omits frontendProfiles', () => {
    const currentMaps = {
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {},
      frontendProfileActivityMap: {
        'frontend-1': { profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 },
      },
    };
    expect(
      buildActivityMapsFromSnapshot(
        {
          jarProfiles: [{ id: 'orders', applicationName: 'Orders', status: 'ACTIVE' }],
        },
        currentMaps,
      ),
    ).toEqual({
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {
        orders: expect.objectContaining({ id: 'orders', applicationName: 'Orders', status: 'ACTIVE' }),
      },
      frontendProfileActivityMap: currentMaps.frontendProfileActivityMap,
    });
  });

  it('replaces frontend profiles when SYSTEM_SNAPSHOT includes an explicit frontendProfiles array', () => {
    expect(
      buildActivityMapsFromSnapshot(
        {
          frontendProfiles: [{ profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 }],
        },
        {
          frontendProfileActivityMap: {
            'frontend-1': { profileUuid: 'frontend-1', profileName: 'orders-ui', port: 3000 },
          },
        },
      ).frontendProfileActivityMap,
    ).toEqual({
      'frontend-2': { profileUuid: 'frontend-2', profileName: 'payments-ui', port: 3001 },
    });
  });

  it('drops stale nonterminal operation progress while retaining active and terminal records', () => {
    const operations = {
      active: { deploymentId: 'active', registered: true },
      stale: { deploymentId: 'stale', registered: true },
      terminal: { deploymentId: 'terminal', statusEvent: 'DEPLOYMENT_SUCCEEDED' },
    };
    expect(
      reconcileOperationsWithSnapshot(operations, {
        wildflyProfiles: [{ activeOperationId: 'active' }],
        jarProfiles: [],
      }),
    ).toEqual({ active: operations.active, terminal: operations.terminal });
  });

  it.each(['FRONTEND_PROFILE_UNRESOLVED', 'FRONTEND_INACTIVE', 'FRONTEND_CONFIGURATION_INVALID'])(
    'treats %s as a non-blocking frontend warning',
    (eventType) => {
      expect(isFrontendWarningEvent(eventType)).toBe(true);
      expect(
        mergeOperationEventRecord(
          { statusEvent: 'DEPLOYMENT_SUCCEEDED' },
          {
            eventType,
            deploymentId: 'deployment-1',
            message: 'Frontend warning',
          },
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
      jarResourceKeyForReconciliation({
        eventType: 'DEPLOYMENT_SUCCEEDED',
        resourceType: 'JAR',
        resourceKey: 'JAR:orders',
      }),
    ).toBe('JAR:orders');
    expect(
      jarResourceKeyForReconciliation({
        eventType: 'RESOURCE_ACTIVE',
        resourceType: 'JAR',
        resourceKey: 'JAR:orders',
      }),
    ).toBe('JAR:orders');
    expect(
      jarResourceKeyForReconciliation({
        eventType: 'RESOURCE_STARTING',
        resourceType: 'JAR',
        resourceKey: 'JAR:orders',
      }),
    ).toBeNull();
    expect(
      jarResourceKeyForReconciliation({
        eventType: 'RESOURCE_ACTIVE',
        resourceType: 'WILDFLY_PROFILE',
        resourceKey: 'WILDFLY_PROFILE:orders',
      }),
    ).toBeNull();
  });
});

describe('operation terminal availability', () => {
  it('keeps the terminal failure status and message when its JAR log becomes available', () => {
    const failed = mergeOperationEventRecord(
      {},
      {
        eventType: 'DEPLOYMENT_FAILED',
        deploymentId: 'deployment-1',
        resourceType: 'JAR',
        message: 'The launcher exited before startup completed.',
      },
    );
    const available = mergeOperationEventRecord(failed, {
      eventType: 'DEPLOYMENT_LOG_AVAILABLE',
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      message: 'A deployment log is available.',
    });

    expect(available).toMatchObject({
      statusEvent: 'DEPLOYMENT_FAILED',
      message: 'The launcher exited before startup completed.',
      logAvailable: true,
    });
  });

  it('changes terminal availability only from matching lifecycle events', () => {
    const responseRecord = {
      deploymentId: 'deployment-1',
      terminalEventsUrl: '/api/terminals/deployment-1/events',
    };
    const available = mergeOperationEventRecord(responseRecord, {
      eventType: 'TERMINAL_AVAILABLE',
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });

    expect(available.terminalAvailabilityConfirmed).toBe(true);
    expect(
      mergeOperationEventRecord(available, {
        eventType: 'OPERATION_PROGRESS',
        deploymentId: 'deployment-1',
      }).terminalAvailabilityConfirmed,
    ).toBe(true);
    expect(
      mergeOperationEventRecord(available, {
        eventType: 'TERMINAL_CLOSED',
        deploymentId: 'deployment-1',
        resourceType: 'JAR',
        resourceKey: 'JAR:orders',
      }).terminalAvailabilityConfirmed,
    ).toBe(false);
  });
});
