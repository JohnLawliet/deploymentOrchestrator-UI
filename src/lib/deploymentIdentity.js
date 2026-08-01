export function deploymentIdOf(value) {
  return value?.deploymentId ?? value?.operationId ?? ''
}

export function currentDeploymentIdOf(value) {
  if (!value || typeof value !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(value, 'currentDeploymentId')) {
    return value.currentDeploymentId
  }
  if (Object.prototype.hasOwnProperty.call(value, 'currentOperationId')) {
    return value.currentOperationId
  }
  return null
}

export function withDeploymentIdentity(value) {
  const deploymentId = deploymentIdOf(value)
  return deploymentId ? { ...value, deploymentId } : value
}
