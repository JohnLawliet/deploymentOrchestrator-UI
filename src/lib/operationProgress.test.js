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

  it('accepts legacy operationId-only progress events', () => {
    const event = progressEvent(undefined)
    delete event.deploymentId
    event.operationId = 'legacy-1'

    expect(reduceOperationProgress({}, parseOperationProgressData(JSON.stringify(event))))
      .toHaveProperty('legacy-1.progress.status', 'DEPLOYING')
  })
})
