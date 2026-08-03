import { describe, expect, it } from 'vitest'
import {
  normalizeDashboardProfile,
  normalizeFrontendProfile,
  normalizeRuntimeActivity,
  normalizeSystemSnapshot,
  overlayRuntimeActivity,
} from './runtimeActivity'

describe('normalizeRuntimeActivity', () => {
  it('maps the complete WildFly runtime record and preserves clearing nulls', () => {
    expect(normalizeRuntimeActivity({
      resourceKey: 'WILDFLY_PROFILE:coin-dcx',
      resourceType: 'WILDFLY_PROFILE',
      profileUuid: 'coin-dcx',
      displayName: 'coinDCX',
      version: 'wildfly-26',
      state: 'ACTIVE',
      currentDeploymentId: 'operation-2',
      pid: 4210,
      portOffset: 5020,
      applicationPort: 13100,
      managementPort: 15010,
      profileHealth: 'FUNCTIONAL',
      deployCount: 1,
      failedDeployCount: 2,
      consecutiveFailures: 0,
      lastDeploymentOn: '2026-07-26T13:20:00Z',
      lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
      lastCheckedAt: '2026-07-26T13:24:11Z',
      lastResult: 'SUCCESS',
    })).toEqual({
      id: 'coin-dcx',
      profileName: 'coinDCX',
      version: 'wildfly-26',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: 4210,
      offset: 5020,
      applicationPort: 13100,
      managementPort: 15010,
      deployCount: 1,
      failedDeployCount: 2,
      consecutiveFailures: 0,
      lastDeploymentOn: '2026-07-26T13:20:00Z',
      lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
      lastUpdatedOn: '2026-07-26T13:24:11Z',
      lastResult: 'SUCCESS',
      currentDeploymentId: 'operation-2',
    })
  })

  it('maps associated and unassociated JAR frontend data without inferring a profile', () => {
    expect(normalizeRuntimeActivity({
      resourceKey: 'JAR:orders',
      resourceType: 'JAR',
      applicationName: 'Orders',
      readinessStatus: 'HTTP_VERIFIED',
      readinessReason: 'Actuator endpoint returned 200.',
      frontendUrl: 'https://fallback.example/orders',
      frontendContextPath: '/orders',
      frontendProfile: {
        profileName: 'orders-ui',
        port: 443,
        documentRoot: '/srv/www/orders',
        serverName: 'orders.example',
        frontendUrl: 'https://orders.example',
        directoryExists: true,
        running: false,
      },
    })).toMatchObject({
      id: 'orders',
      readinessStatus: 'HTTP_VERIFIED',
      readinessReason: 'Actuator endpoint returned 200.',
      frontendUrl: 'https://fallback.example/orders',
      frontendContextPath: '/orders',
      frontendProfile: {
        profileName: 'orders-ui',
        port: 443,
        documentRoot: '/srv/www/orders',
        serverName: 'orders.example',
        frontendUrl: 'https://orders.example',
        directoryExists: true,
        running: false,
      },
    })

    expect(normalizeRuntimeActivity({
      resourceKey: 'JAR:ambiguous',
      resourceType: 'JAR',
      applicationName: 'Ambiguous',
      frontendUrl: 'https://ambiguous.example',
      frontendContextPath: '/ambiguous',
      frontendProfile: null,
    })).toMatchObject({
      id: 'ambiguous',
      frontendUrl: 'https://ambiguous.example',
      frontendContextPath: '/ambiguous',
      frontendProfile: null,
    })
  })

  it('keeps failed dashboard JAR catalogue entries visible by their backend id', () => {
    expect(normalizeRuntimeActivity({
      id: '4fe7a947-883f-484e-8108-ee9d3c354393',
      resourceType: 'JAR',
      name: 'testProject',
      applicationName: 'testProject',
      jarName: 'testProject.jar',
      status: 'FAILED',
      health: 'FUNCTIONAL',
      readiness: 'NOT_VERIFIED',
      lastResult: 'Health verification failed',
    })).toMatchObject({
      id: '4fe7a947-883f-484e-8108-ee9d3c354393',
      applicationName: 'testProject',
      jarName: 'testProject.jar',
      status: 'FAILED',
      health: 'FUNCTIONAL',
      readinessStatus: 'NOT_VERIFIED',
      lastResult: 'Health verification failed',
    })
  })
})

describe('normalizeFrontendProfile', () => {
  it('preserves the complete frontend profile contract', () => {
    expect(normalizeFrontendProfile({
      profileName: 'orders-ui',
      port: 3000,
      documentRoot: '/srv/www/orders',
      serverName: 'orders.example',
      frontendUrl: 'https://orders.example',
      directoryExists: false,
      running: true,
    })).toEqual({
      profileName: 'orders-ui',
      port: 3000,
      documentRoot: '/srv/www/orders',
      serverName: 'orders.example',
      frontendUrl: 'https://orders.example',
      directoryExists: false,
      running: true,
    })
  })
})

describe('normalizeDashboardProfile', () => {
  it('maps the expanded dashboard profile contract', () => {
    expect(normalizeDashboardProfile({
      id: 'profile-1',
      name: 'payments-qc',
      application: 'payments',
      version: 'wildfly-26',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: 4210,
      currentDeploymentId: 'operation-2',
      offset: 5020,
      applicationPort: 13100,
      managementPort: 15010,
      deployCount: 4,
      failedDeployCount: 3,
      consecutiveFailures: 1,
      lastDeploymentOn: '2026-07-26T13:20:00Z',
      lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
      lastUpdatedOn: '2026-07-26T13:24:11Z',
      lastResult: 'FAILED',
    })).toEqual({
      id: 'profile-1',
      profileName: 'payments-qc',
      application: 'payments',
      version: 'wildfly-26',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: 4210,
      currentDeploymentId: 'operation-2',
      offset: 5020,
      applicationPort: 13100,
      managementPort: 15010,
      deployCount: 4,
      failedDeployCount: 3,
      consecutiveFailures: 1,
      lastDeploymentOn: '2026-07-26T13:20:00Z',
      lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
      lastUpdatedOn: '2026-07-26T13:24:11Z',
      lastResult: 'FAILED',
    })
  })

  it('preserves authoritative status and health with a null PID and defaults failed deployments', () => {
    expect(normalizeDashboardProfile({
      id: 'profile-2',
      name: 'orders-qc',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: null,
      portOffset: 300,
    })).toEqual({
      id: 'profile-2',
      profileName: 'orders-qc',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: null,
      currentDeploymentId: null,
      offset: 300,
      failedDeployCount: 0,
    })
  })

  it('lets defined live activity override the initial profile and retain clearing nulls', () => {
    expect(overlayRuntimeActivity(
      { id: 'profile-1', status: 'INACTIVE', health: 'UNKNOWN', pid: null, application: 'payments' },
      { status: 'ACTIVE', health: 'FUNCTIONAL', pid: 9001, application: undefined, currentDeploymentId: null },
    )).toEqual({
      id: 'profile-1',
      status: 'ACTIVE',
      health: 'FUNCTIONAL',
      pid: 9001,
      application: 'payments',
      currentDeploymentId: null,
    })
  })
})

describe('normalizeSystemSnapshot', () => {
  it('rebuilds both activity maps with backup fields and canonical current IDs', () => {
    expect(normalizeSystemSnapshot({
      wildflyProfiles: [{
        id: 'profile-1',
        profileName: 'payments-qc',
        status: 'INACTIVE',
        currentDeploymentId: null,
        hasBackup: true,
        backupSnapshotId: 'snapshot-1',
      }],
      jarProfiles: [{
        id: 'orders',
        applicationName: 'orders',
        status: 'ACTIVE',
        currentDeploymentId: 'deployment-2',
        frontendProfile: null,
      }],
      frontendProfiles: [{
        profileName: 'orders-ui',
        port: 3000,
        documentRoot: '/srv/www/orders',
        serverName: 'orders.example',
        frontendUrl: 'https://orders.example',
        directoryExists: true,
        running: true,
      }],
    })).toMatchObject({
      wildflyProfiles: [{
        id: 'profile-1',
        profileName: 'payments-qc',
        status: 'INACTIVE',
        currentDeploymentId: null,
        hasBackup: true,
        backupSnapshotId: 'snapshot-1',
      }],
      jarProfiles: [{
        id: 'orders',
        applicationName: 'orders',
        status: 'ACTIVE',
        currentDeploymentId: 'deployment-2',
        frontendProfile: null,
      }],
      frontendProfiles: [{
        profileName: 'orders-ui',
        port: 3000,
        documentRoot: '/srv/www/orders',
        serverName: 'orders.example',
        frontendUrl: 'https://orders.example',
        directoryExists: true,
        running: true,
      }],
    })
  })
})
