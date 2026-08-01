import { describe, expect, it } from 'vitest'
import { currentDeploymentIdOf, deploymentIdOf, withDeploymentIdentity } from './deploymentIdentity'

describe('deployment identity compatibility', () => {
  it('prefers deploymentId and falls back to operationId', () => {
    expect(deploymentIdOf({ deploymentId: 'deployment-1', operationId: 'legacy-1' })).toBe('deployment-1')
    expect(deploymentIdOf({ operationId: 'legacy-1' })).toBe('legacy-1')
    expect(withDeploymentIdentity({ operationId: 'legacy-1' })).toEqual({
      deploymentId: 'legacy-1',
      operationId: 'legacy-1',
    })
  })

  it('preserves an explicit canonical null when clearing current activity', () => {
    expect(currentDeploymentIdOf({
      currentDeploymentId: null,
      currentOperationId: 'stale-operation',
    })).toBeNull()
    expect(currentDeploymentIdOf({ currentOperationId: 'legacy-operation' })).toBe('legacy-operation')
  })
})
