import { describe, expect, it } from 'vitest';
import { QC_WAR_PHASES, QC_WAR_TIMELINE, qcWarPhaseLabel } from './qcWarProgress';

describe('QC WAR progress catalog', () => {
  it('maps optimized staging phases without implying that WildFly stopped during extraction', () => {
    expect(QC_WAR_PHASES.WAR_EXTRACTING).toMatchObject({ label: 'Extracting inbound WAR', percentage: 20 });
    expect(QC_WAR_PHASES.QC_MERGING).toMatchObject({ label: 'Applying QC configuration', percentage: 30 });
    expect(QC_WAR_PHASES.QC_STAGING_READY).toMatchObject({ label: 'QC staging completed', percentage: 45 });
    expect(QC_WAR_TIMELINE.find((step) => step.id === 'stop')?.label).toBe('Stop profile');
  });

  it('keeps future phase codes displayable', () => {
    expect(qcWarPhaseLabel('FUTURE_PHASE')).toBeNull();
  });
});
