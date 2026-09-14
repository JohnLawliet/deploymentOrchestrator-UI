import type { FileMoveProgressDto } from '@/types/api-contracts';

export type FileMoveTimelineStep = {
  id: string;
  label: string;
  description: string;
  phaseCodes: readonly string[];
};

type FileMovePhase = {
  label: string;
  percentage: number;
  timelineId: string;
};

/** Fixed WAR-style milestones driven only by backend phase events. */
export const FILE_MOVE_PHASES: Readonly<Record<string, FileMovePhase>> = {
  FILE_MOVE_STARTED: { label: 'Starting…', percentage: 5, timelineId: 'start' },
  FILE_MOVE_CREATING_TEMP: { label: 'Creating temp directory', percentage: 15, timelineId: 'temp' },
  FILE_MOVE_ZIPPING: { label: 'Zipping', percentage: 40, timelineId: 'zip' },
  FILE_MOVE_TRANSFERRING: { label: 'Transferring', percentage: 70, timelineId: 'transfer' },
  FILE_MOVE_DELETING_TEMP: { label: 'Deleting temp', percentage: 90, timelineId: 'cleanup' },
  FILE_MOVE_ITEM_COMPLETED: { label: 'Item completed', percentage: 100, timelineId: 'complete' },
  FILE_MOVE_ITEM_FAILED: { label: 'Item failed', percentage: 100, timelineId: 'complete' },
};

export const FILE_MOVE_ARCHIVE_TIMELINE: readonly FileMoveTimelineStep[] = [
  {
    id: 'start',
    label: 'Start',
    description: 'Validates the move plan and begins processing selected items.',
    phaseCodes: ['FILE_MOVE_STARTED'],
  },
  {
    id: 'temp',
    label: 'Create temp',
    description: 'Creates a temporary directory for archive packaging.',
    phaseCodes: ['FILE_MOVE_CREATING_TEMP'],
  },
  {
    id: 'zip',
    label: 'Zip',
    description: 'Packages the selected source into the chosen archive format.',
    phaseCodes: ['FILE_MOVE_ZIPPING'],
  },
  {
    id: 'transfer',
    label: 'Transfer',
    description: 'Copies or moves the archive to the destination.',
    phaseCodes: ['FILE_MOVE_TRANSFERRING'],
  },
  {
    id: 'cleanup',
    label: 'Cleanup',
    description: 'Removes temporary packaging files after transfer.',
    phaseCodes: ['FILE_MOVE_DELETING_TEMP'],
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Marks the current item as completed or failed.',
    phaseCodes: ['FILE_MOVE_ITEM_COMPLETED', 'FILE_MOVE_ITEM_FAILED'],
  },
];

export const FILE_MOVE_PLAIN_TIMELINE: readonly FileMoveTimelineStep[] = [
  {
    id: 'start',
    label: 'Start',
    description: 'Validates the move plan and begins processing selected items.',
    phaseCodes: ['FILE_MOVE_STARTED'],
  },
  {
    id: 'transfer',
    label: 'Transfer',
    description: 'Copies or moves the selected path to the destination.',
    phaseCodes: ['FILE_MOVE_TRANSFERRING'],
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Marks the current item as completed or failed.',
    phaseCodes: ['FILE_MOVE_ITEM_COMPLETED', 'FILE_MOVE_ITEM_FAILED'],
  },
];

export const fileMovePhase = (phaseCode: string | null | undefined): FileMovePhase | null =>
  (phaseCode && FILE_MOVE_PHASES[phaseCode]) || null;

export const fileMovePhaseLabel = (phaseCode: string | null | undefined): string | null =>
  fileMovePhase(phaseCode)?.label || null;

export const fileMovePhasePercentage = (phaseCode: string | null | undefined): number | null => {
  const phase = fileMovePhase(phaseCode);
  return phase ? phase.percentage : null;
};

export const fileMoveTimeline = (archiving: boolean): readonly FileMoveTimelineStep[] =>
  archiving ? FILE_MOVE_ARCHIVE_TIMELINE : FILE_MOVE_PLAIN_TIMELINE;

/** Display percentage for the move progress bar, independent of item counts. */
export function fileMoveDisplayPercentage(
  progress: Pick<FileMoveProgressDto, 'phaseCode'> | null,
  options?: { done?: boolean },
): number {
  if (options?.done) return 100;
  if (!progress) return 0;
  return fileMovePhasePercentage(progress.phaseCode) ?? 0;
}
