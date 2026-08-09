import { describe, expect, it } from 'vitest';
import { activeOperationIdOf, deploymentIdOf, withDeploymentIdentity } from './deploymentIdentity';

describe('deployment identity compatibility', () => {
  it('prefers deploymentId and falls back to operationId', () => {
    expect(deploymentIdOf({ deploymentId: 'deployment-1', operationId: 'legacy-1' })).toBe('deployment-1');
    expect(deploymentIdOf({ operationId: 'legacy-1' })).toBe('legacy-1');
    expect(withDeploymentIdentity({ operationId: 'legacy-1' })).toEqual({
      deploymentId: 'legacy-1',
      operationId: 'legacy-1',
    });
  });

  it('preserves the transient active operation identity including an explicit null', () => {
    expect(activeOperationIdOf({ activeOperationId: null })).toBeNull();
    expect(activeOperationIdOf({ activeOperationId: 'operation-1' })).toBe('operation-1');
    expect(activeOperationIdOf({})).toBeNull();
  });
});
