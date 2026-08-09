import type { UploadItem, UploadMode, UploadOperationStatus, UploadResponse } from '@/types/api-contracts';

export const UPLOAD_MODES = Object.freeze({
  REGULAR: 'REGULAR',
  FRONTEND_HOTFIX: 'FRONTEND_HOTFIX',
  WILDFLY_HOTFIX: 'WILDFLY_HOTFIX',
});

export const UPLOAD_TARGET_KINDS = Object.freeze({
  QC_PATH: 'QC_PATH',
  FRONTEND_PROFILE: 'FRONTEND_PROFILE',
  WILDFLY_PROFILE: 'WILDFLY_PROFILE',
});

export const UPLOAD_TERMINAL_STATUSES: ReadonlySet<UploadOperationStatus> = new Set(['COMPLETED', 'FAILED']);
export const UPLOAD_RUNNING_STATUSES: ReadonlySet<UploadOperationStatus> = new Set(['QUEUED', 'RUNNING', 'ROLLING_BACK']);
export const UPLOAD_EVENT_TYPES = new Set([
  'UPLOAD_OPERATION_UPDATED',
  'UPLOAD_OPERATION_COMPLETED',
  'UPLOAD_OPERATION_FAILED',
  'UPLOAD_ITEM_PROCESSING',
  'UPLOAD_ITEM_SUCCEEDED',
  'UPLOAD_ITEM_FAILED',
  'UPLOAD_RESTART_STARTED',
  'UPLOAD_RESTART_COMPLETED',
  'UPLOAD_ITEM_ROLLED_BACK',
  'UPLOAD_ITEM_ROLLBACK_FAILED',
]);

export const isUploadTerminal = (operation: Pick<UploadResponse, 'status'> | null | undefined): boolean =>
  operation !== null && operation !== undefined && UPLOAD_TERMINAL_STATUSES.has(operation.status);
export const isUploadRunning = (operation: Pick<UploadResponse, 'status'> | null | undefined): boolean =>
  operation !== null && operation !== undefined && UPLOAD_RUNNING_STATUSES.has(operation.status);

export function uploadStorageKey(username: string): string {
  return `upload-operation:${String(username || '').trim()}`;
}

export function displayUploadItemName(
  item: UploadItem | null | undefined,
  duplicateNames: ReadonlySet<string> = new Set(),
): string {
  if (!item) return '';
  return duplicateNames.has(item.name) ? `${item.name} (${item.sourcePath})` : item.name || item.sourcePath;
}

export function duplicateUploadItemNames(items: UploadItem[] = []): Set<string> {
  const counts = items.reduce<Record<string, number>>((current, item) => {
    if (item?.name) current[item.name] = (current[item.name] || 0) + 1;
    return current;
  }, {});
  return new Set(
    Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
}

export function canExecuteWarHotfix(
  operation: UploadResponse | null | undefined,
  selectedTargets: Record<string, string> = {},
): boolean {
  const items = operation?.items ?? [];
  const deployable = items.some((item) => item.status === 'READY' || item.status === 'AMBIGUOUS');
  return (
    deployable &&
    items
      .filter((item) => item.status === 'AMBIGUOUS')
      .every((item) => item.candidates?.includes(selectedTargets[item.sourcePath]))
  );
}
