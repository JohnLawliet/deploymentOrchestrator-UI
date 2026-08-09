type DeploymentIdentity = { deploymentId?: string | null; operationId?: string | null };
type ActiveOperationIdentity = { activeOperationId?: string | null };

export function deploymentIdOf(value: DeploymentIdentity | null | undefined): string {
  return value?.deploymentId ?? value?.operationId ?? '';
}

export function activeOperationIdOf(value: ActiveOperationIdentity | null | undefined): string | null {
  return value?.activeOperationId ?? null;
}

export function withDeploymentIdentity<T extends DeploymentIdentity>(value: T) {
  const deploymentId = deploymentIdOf(value);
  if (!deploymentId) return value;
  return { ...value, deploymentId };
}
