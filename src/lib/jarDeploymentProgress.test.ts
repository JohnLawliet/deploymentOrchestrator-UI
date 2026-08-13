import { describe, expect, it } from 'vitest';
import { isJarDeploymentPhase, jarDeploymentPhase, jarDeploymentPhaseLabel, jarDeploymentTimeline } from './jarDeploymentProgress';

describe('JAR deployment progress definitions', () => {
  it.each([
    ['METADATA_RESOLVED', 'initialize'],
    ['LOCK_SECURED', 'lock'],
    ['FRONTEND_STAGING', 'frontend-stage'],
    ['SNAPSHOT_READY', 'snapshot'],
    ['ARTIFACT_COPYING', 'deploy'],
    ['HEALTH_VERIFYING', 'health'],
    ['FRONTEND_PUBLISHING', 'frontend-publish'],
    ['CLEANUP', 'finalize'],
  ])('maps %s to %s', (phaseCode, timelineId) => {
    expect(jarDeploymentPhase(phaseCode)?.timelineId).toBe(timelineId);
    expect(isJarDeploymentPhase(phaseCode)).toBe(true);
  });

  it.each([
    ['ROLLBACK_STARTED', 'Restoring previous JAR deployment'],
    ['ROLLBACK_COMPLETED', 'JAR rollback completed'],
    ['FAILED', 'Deployment failed'],
  ])('exposes terminal phase %s without assigning it to a normal timeline step', (phaseCode, label) => {
    expect(jarDeploymentPhaseLabel(phaseCode)).toBe(label);
    expect(jarDeploymentPhase(phaseCode)?.timelineId).toBeUndefined();
  });

  it('includes frontend stages only for combined JAR and frontend deployments', () => {
    expect(jarDeploymentTimeline(false).map((step) => step.id)).not.toContain('frontend-stage');
    expect(jarDeploymentTimeline(false).map((step) => step.id)).not.toContain('frontend-publish');
    expect(jarDeploymentTimeline(true).map((step) => step.id)).toEqual(
      expect.arrayContaining(['frontend-stage', 'frontend-publish']),
    );
  });

  it('exposes a description for every timeline step', () => {
    const timeline = jarDeploymentTimeline(true);
    expect(timeline).toHaveLength(10);
    for (const step of timeline) {
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
    expect(timeline.find((step) => step.id === 'deploy')?.description).toBe(
      'Copies the new JAR into the runtime location.',
    );
  });
});
