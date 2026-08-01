import { describe, expect, it } from 'vitest'
import { mergeActivityMap } from './PortalContext'

const profile = {
  id: 'profile-1',
  status: 'DEPLOYING',
  currentDeploymentId: 'deployment-1',
  failedDeployCount: 2,
}

describe('lifecycle activity reduction', () => {
  it('marks WildFly server logs available without attaching a terminal', () => {
    const initial = {
      'profile-1': profile,
      'profile-2': { id: 'profile-2', currentDeploymentId: null },
    }
    const reduced = mergeActivityMap(initial, {
      eventType: 'TERMINAL_AVAILABLE',
      deploymentId: 'deployment-2',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    })

    expect(reduced['profile-1'].currentDeploymentId).toBe('deployment-1')
    expect(reduced['profile-1'].serverLogAvailable).toBe(true)
    expect(reduced['profile-2'].currentDeploymentId).toBeNull()
    expect(mergeActivityMap({}, {
      eventType: 'TERMINAL_AVAILABLE',
      deploymentId: 'deployment-2',
      resourceKey: 'WILDFLY_PROFILE:missing',
    })).toEqual({
      missing: { id: 'missing', serverLogAvailable: true },
    })
  })

  it('attaches and closes terminals only for JAR resources', () => {
    const jar = { 'jar-1': { id: 'jar-1', currentDeploymentId: null } }
    const attached = mergeActivityMap(jar, {
      eventType: 'TERMINAL_AVAILABLE',
      resourceType: 'JAR',
      deploymentId: 'deployment-2',
      resourceKey: 'JAR:jar-1',
    })
    expect(attached['jar-1'].currentDeploymentId).toBe('deployment-2')
    expect(mergeActivityMap(attached, {
      eventType: 'TERMINAL_CLOSED',
      resourceType: 'JAR',
      deploymentId: 'deployment-2',
      resourceKey: 'JAR:jar-1',
    })['jar-1'].currentDeploymentId).toBeNull()
  })

  it('retains terminal availability after failure while applying the final recovered state', () => {
    const reduced = mergeActivityMap({ 'profile-1': profile }, {
      eventType: 'DEPLOYMENT_FAILED',
      deploymentId: 'deployment-1',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      resourceType: 'WILDFLY_PROFILE',
      state: 'ACTIVE',
      pid: 4210,
      currentDeploymentId: null,
      deployCount: 8,
      failedDeployCount: 3,
      consecutiveFailures: 1,
      lastResult: 'FAILED',
      hasBackup: true,
      backupSnapshotId: 'snapshot-1',
      timestamp: '2026-07-28T10:00:00Z',
    })

    expect(reduced['profile-1']).toMatchObject({
      status: 'ACTIVE',
      pid: 4210,
      currentDeploymentId: 'deployment-1',
      deployCount: 8,
      failedDeployCount: 3,
      consecutiveFailures: 1,
      lastResult: 'FAILED',
      hasBackup: true,
      backupSnapshotId: 'snapshot-1',
    })
  })

  it('does not treat a WildFly terminal close as profile-log state', () => {
    const retained = { 'profile-1': { ...profile, status: 'ACTIVE', lastResult: 'FAILED' } }
    expect(mergeActivityMap(retained, {
      eventType: 'TERMINAL_CLOSED',
      deploymentId: 'deployment-1',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    })['profile-1'].currentDeploymentId).toBe('deployment-1')

    expect(mergeActivityMap(retained, {
      eventType: 'TERMINAL_CLOSED',
      deploymentId: 'another-deployment',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    })['profile-1'].currentDeploymentId).toBe('deployment-1')
  })

  it('marks profile logs unavailable using a direct profile ID', () => {
    expect(mergeActivityMap({ 'profile-1': { ...profile, serverLogAvailable: true } }, {
      eventType: 'PROFILE_LOG_UNAVAILABLE',
      profileId: 'profile-1',
      resourceType: 'WILDFLY_PROFILE',
    })['profile-1'].serverLogAvailable).toBe(false)
  })

  it('can rebuild a missing profile row from a lifecycle resource key', () => {
    expect(mergeActivityMap({}, {
      eventType: 'DEPLOYMENT_FAILED',
      resourceKey: 'WILDFLY_PROFILE:profile-2',
      state: 'INACTIVE',
      currentDeploymentId: null,
      lastResult: 'FAILED',
    })).toEqual({
      'profile-2': {
        id: 'profile-2',
        status: 'INACTIVE',
        lastResult: 'FAILED',
      },
    })
  })
})
