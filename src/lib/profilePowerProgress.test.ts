import { describe, expect, it } from 'vitest';
import { profilePowerPhaseLabel, profilePowerTimeline } from './profilePowerProgress';

describe('profile power progress catalog', () => {
  it('maps the backend start phases to the dashboard start timeline', () => {
    expect(profilePowerTimeline('PROFILE_START').map((step) => step.id)).toEqual([
      'prepare',
      'start',
      'wait',
      'health',
      'complete',
    ]);
    expect(profilePowerPhaseLabel('DEPLOYMENT_MARKER_WAIT')).toBe('Waiting for WAR deployment');
  });

  it('maps the backend stop phases to the dashboard stop timeline', () => {
    expect(profilePowerTimeline('PROFILE_STOP').map((step) => step.id)).toEqual(['stop', 'complete']);
    expect(profilePowerPhaseLabel('PROFILE_STOPPING')).toBe('Stopping WildFly');
  });
});
