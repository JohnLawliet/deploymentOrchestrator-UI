export function deploymentIdOf(value) {
  return value?.deploymentId ?? value?.operationId ?? '';
}

export function activeOperationIdOf(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'activeOperationId')) {
    return value.activeOperationId;
  }
  return null;
}

export function withDeploymentIdentity(value) {
  const deploymentId = deploymentIdOf(value);
  return deploymentId ? { ...value, deploymentId } : value;
}
