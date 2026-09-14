import { describe, expect, it } from 'vitest';
import {
  FILE_MOVE_ARCHIVE_TIMELINE,
  FILE_MOVE_PLAIN_TIMELINE,
  fileMoveDisplayPercentage,
  fileMovePhaseLabel,
  fileMovePhasePercentage,
  fileMoveTimeline,
} from './fileMoveProgress';

describe('fileMoveProgress', () => {
  it('maps phase codes to labels and milestone percentages', () => {
    expect(fileMovePhaseLabel('FILE_MOVE_ZIPPING')).toBe('Zipping');
    expect(fileMovePhaseLabel('FILE_MOVE_TRANSFERRING')).toBe('Transferring');
    expect(fileMovePhaseLabel('FILE_MOVE_EXTRACTING')).toBeNull();
    expect(fileMovePhasePercentage('FILE_MOVE_STARTED')).toBe(5);
    expect(fileMovePhasePercentage('FILE_MOVE_ZIPPING')).toBe(40);
    expect(fileMovePhasePercentage('FILE_MOVE_TRANSFERRING')).toBe(70);
    expect(fileMovePhasePercentage('FILE_MOVE_ITEM_COMPLETED')).toBe(100);
  });

  it('returns archive vs plain timelines', () => {
    expect(fileMoveTimeline(true)).toBe(FILE_MOVE_ARCHIVE_TIMELINE);
    expect(fileMoveTimeline(false)).toBe(FILE_MOVE_PLAIN_TIMELINE);
    expect(FILE_MOVE_ARCHIVE_TIMELINE.map((step) => step.id)).toEqual([
      'start',
      'temp',
      'zip',
      'transfer',
      'cleanup',
      'complete',
    ]);
    expect(FILE_MOVE_PLAIN_TIMELINE.map((step) => step.id)).toEqual(['start', 'transfer', 'complete']);
  });

  it('derives display percentage exclusively from phases', () => {
    expect(fileMoveDisplayPercentage({ phaseCode: 'FILE_MOVE_TRANSFERRING' })).toBe(70);
    expect(fileMoveDisplayPercentage({ phaseCode: 'FILE_MOVE_ZIPPING' })).toBe(40);
  });

  it('ignores item counts and backend item-based percentage', () => {
    const itemBasedProgress = {
      totalCount: 3,
      completedCount: 3,
      failedCount: 0,
      progressPercentage: 100,
      phaseCode: 'FILE_MOVE_ZIPPING',
    } as const;
    expect(fileMoveDisplayPercentage(itemBasedProgress)).toBe(40);
  });

  it('uses terminal phases or HTTP completion for 100%', () => {
    expect(fileMoveDisplayPercentage({ phaseCode: 'FILE_MOVE_ITEM_COMPLETED' })).toBe(100);
    expect(fileMoveDisplayPercentage({ phaseCode: 'FILE_MOVE_TRANSFERRING' }, { done: true })).toBe(100);
  });
});
