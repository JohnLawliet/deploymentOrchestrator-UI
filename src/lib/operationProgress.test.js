import { describe, expect, it } from 'vitest'
import {
  parseOperationProgressData,
  reduceOperationProgress,
  registerOperationInMap,
} from './operationProgress'

const progressEvent = (identity) => ({
  eventType: 'OPERATION_PROGRESS',
  timestamp: '2026-07-28T10:00:00Z',
  deploymentId: identity,
  resourceKey: 'WILDFLY_PROFILE:profile-1',
  resourceType: 'WILDFLY_PROFILE',
  state: null,
  pid: null,
  username: 'deploy-user',
  message: 'Deploying',
  resources: {
    phaseCode: 'DEPLOY',
    status: 'DEPLOYING',
    progressPercentage: 50,
    component: 'WildFly',
  },
})

describe('operation progress canonical correlation', () => {
  it('keys canonical progress and registration by deploymentId', () => {
    const event = progressEvent('deployment-1')
    const parsed = parseOperationProgressData(JSON.stringify(event))
    const progressed = reduceOperationProgress({}, parsed)
    const registered = registerOperationInMap(
      progressed,
      { deploymentId: 'deployment-1', operationId: 'legacy-1' },
      event.resourceKey,
      'Deploy',
    )

    expect(Object.keys(registered)).toEqual(['deployment-1'])
    expect(registered['deployment-1']).toMatchObject({
      deploymentId: 'deployment-1',
      registered: true,
      progress: { phaseCode: 'DEPLOY', progressPercentage: 50 },
    })
  })

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
    )

    expect(registered['deployment-1'].terminalAvailabilityConfirmed).toBe(true)
  })

  it('requires a JAR log availability event instead of trusting the operation response', () => {
    const unconfirmed = registerOperationInMap(
      {},
      { deploymentId: 'deployment-1', resourceType: 'JAR', logAvailable: true },
      'JAR:orders',
      'Deploy JAR',
    )
    const confirmed = registerOperationInMap(
      { 'deployment-1': { deploymentId: 'deployment-1', logAvailable: true } },
      { deploymentId: 'deployment-1', resourceType: 'JAR', logAvailable: false },
      'JAR:orders',
      'Deploy JAR',
    )

    expect(unconfirmed['deployment-1']).not.toHaveProperty('logAvailable')
    expect(confirmed['deployment-1'].logAvailable).toBe(true)
  })

  it('accepts legacy operationId-only progress events', () => {
    const event = progressEvent(undefined)
    delete event.deploymentId
    event.operationId = 'legacy-1'

    expect(reduceOperationProgress({}, parseOperationProgressData(JSON.stringify(event))))
      .toHaveProperty('legacy-1.progress.status', 'DEPLOYING')
  })

  it('retains shared progress from another validated user as an unregistered operation', () => {
    const event = progressEvent('shared-deployment')
    event.username = 'another-user'
    event.resourceKey = 'JAR:opaque-uuid'
    event.resourceType = 'JAR'

    expect(reduceOperationProgress({}, event)).toMatchObject({
      'shared-deployment': {
        deploymentId: 'shared-deployment',
        progress: {
          username: 'another-user',
          resourceKey: 'JAR:opaque-uuid',
          resourceType: 'JAR',
        },
      },
    })
  })

  it('locks completed progress at 100 percent and ignores later progress events', () => {
    const completed = progressEvent('deployment-1')
    completed.message = 'Deployment completed.'
    completed.resources = {
      ...completed.resources,
      phaseCode: 'COMPLETE',
      status: 'COMPLETED',
      progressPercentage: 80,
    }
    const terminal = reduceOperationProgress({}, completed)
    const stale = progressEvent('deployment-1')
    stale.timestamp = '2026-07-28T10:01:00Z'
    stale.message = 'Restarting application'
    stale.resources = {
      ...stale.resources,
      phaseCode: 'RESTARTING',
      status: 'RESTARTING',
      progressPercentage: 80,
    }

    expect(terminal['deployment-1'].progress.progressPercentage).toBe(100)
    expect(reduceOperationProgress(terminal, stale)).toBe(terminal)
  })

  it('keeps a failed progress message terminal when later progress arrives', () => {
    const failed = progressEvent('deployment-1')
    failed.message = 'Health verification timed out.'
    failed.resources = { ...failed.resources, status: 'FAILED', progressPercentage: 80 }
    const terminal = reduceOperationProgress({}, failed)
    const stale = progressEvent('deployment-1')
    stale.timestamp = '2026-07-28T10:01:00Z'

    expect(reduceOperationProgress(terminal, stale)).toBe(terminal)
    expect(terminal['deployment-1'].progress.message).toBe('Health verification timed out.')
  })
})
