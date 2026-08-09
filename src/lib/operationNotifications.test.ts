import { describe, expect, it } from 'vitest';
import { formatCompletionNotification } from './operationNotifications';
import { systemEvent } from '@/test/factories';
import type { SystemEvent } from '@/types/api-contracts';

const event = (section: string, resourceKey: string, resourceType = section, operationId = 'operation-1') =>
  systemEvent<Extract<SystemEvent, { eventType: 'OPERATION_FINISHED' }>>({
    eventType: 'OPERATION_FINISHED',
    deploymentId: operationId,
    username: 'John Smith',
    state: 'COMPLETED',
    resources: {
      operationId,
      username: 'John Smith',
      section,
      resourceKey,
      resourceType,
      outcome: 'COMPLETED',
      completedAt: '2026-08-09T00:00:00Z',
      summary: 'Completed',
    },
  });

const maps = {
  wildflyProfileActivityMap: { 'profile-1': { id: 'profile-1', profileName: 'Orders profile' } },
  jarProfileActivityMap: { orders: { id: 'orders', applicationName: 'Orders API' } },
  frontendProfileActivityMap: { 'orders-ui': { profileName: 'Orders UI', port: 3001 } },
};
const completionContext = { activityMaps: maps, lockLabels: {}, resolvedResource: null };

describe('completion notification formatting', () => {
  it.each([
    [event('WAR', 'WILDFLY_PROFILE:profile-1', 'WILDFLY_PROFILE'), 'WAR operation completed', 'Orders profile'],
    [event('JAR', 'JAR:orders'), 'JAR operation completed', 'Orders API application'],
    [event('UAT', 'UAT:Orders'), 'UAT build completed', 'Orders application'],
    [event('HOTFIX', 'WILDFLY_PROFILE:profile-1', 'WILDFLY_PROFILE'), 'Hotfix completed', 'Orders profile'],
    [event('HOTFIX', 'WILDFLY_PROFILE:3001', 'WILDFLY_PROFILE'), 'Hotfix completed', 'Orders UI frontend'],
    [event('FILE', 'FILE:qc', 'FILE'), 'File operation completed', 'QC files'],
  ])('formats %s with a concise heading and human target', (input, heading, targetLabel) => {
    expect(formatCompletionNotification(input, completionContext)).toMatchObject({
      heading,
      username: 'John Smith',
      targetLabel,
      deploymentId: 'operation-1',
    });
  });

  it('uses a remembered released-lock label for uploads', () => {
    expect(
      formatCompletionNotification(event('UPLOAD', 'UPLOAD:operation-1', 'FILE'), {
        ...completionContext,
        lockLabels: { 'operation-1': 'releases/orders' },
      }).targetLabel,
    ).toBe('releases/orders target');
  });

  it('uses a generic profile label instead of exposing an unresolved opaque ID', () => {
    const toast = formatCompletionNotification(
      event('WAR', 'WILDFLY_PROFILE:9b64b03b-2aca-4cf0-8332-423ba15a2c5f', 'WILDFLY_PROFILE'),
      completionContext,
    );
    expect(toast.targetLabel).toBe('WildFly profile');
    expect(toast.targetLabel).not.toContain('9b64b03b');
  });
});
