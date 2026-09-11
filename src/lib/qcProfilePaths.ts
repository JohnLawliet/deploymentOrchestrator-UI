import type { RootKey } from '@/types/api-contracts';

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');

const normalizeForCompare = (value: string): string => normalizePath(value).toLowerCase();

/** Map an absolute path under the QC root to a QC root-relative path, or null if outside. */
export function toQcRelative(absolutePath: string, qcRootAbsolute: string): string | null {
  const rootNorm = normalizeForCompare(qcRootAbsolute);
  const absNorm = normalizeForCompare(absolutePath);
  if (!rootNorm || !absNorm) return null;
  if (absNorm === rootNorm) return '.';
  if (!absNorm.startsWith(`${rootNorm}/`)) return null;
  const rootLen = normalizePath(qcRootAbsolute).length;
  return normalizePath(absolutePath).slice(rootLen + 1);
}

const coversSource = (base: string, source: string): boolean => source === base || source.startsWith(`${base}/`);

/**
 * When every source path sits under the same registered profile directory (QC-relative),
 * return that relative base. Nested matching profiles prefer the longest prefix.
 * Mixed profiles or no match → null.
 */
export function sharedProfileBasePath(
  sourcePaths: string[],
  profileDirsAbsolute: string[],
  qcRootAbsolute: string,
): string | null {
  if (!sourcePaths.length || !qcRootAbsolute) return null;
  const sources = sourcePaths.map((path) => normalizePath(path)).filter(Boolean);
  if (!sources.length) return null;

  const profileBases = [
    ...new Set(
      profileDirsAbsolute
        .map((dir) => toQcRelative(dir, qcRootAbsolute))
        .filter((base): base is string => !!base && base !== '.'),
    ),
  ];

  const covering = profileBases.filter((base) => sources.every((source) => coversSource(base, source)));
  if (!covering.length) return null;

  return covering.reduce((best, current) => (current.length > best.length ? current : best));
}

export type FileMoveArchiveChoice = 'NONE' | 'ZIP' | 'WAR' | 'JAR';

const ARCHIVE_SUFFIXES = ['.tar.gz', '.zip', '.war', '.jar'] as const;

export function isCrossRootArchiveRequired(sourceRootKey: RootKey, destinationRootKey: RootKey): boolean {
  return sourceRootKey === 'qc' && destinationRootKey === 'techDrive';
}

/** UI options for the move drawer given the root pair. */
export function archiveFormatOptions(
  sourceRootKey: RootKey,
  destinationRootKey: RootKey,
): FileMoveArchiveChoice[] {
  if (isCrossRootArchiveRequired(sourceRootKey, destinationRootKey)) return ['ZIP', 'WAR', 'JAR'];
  return ['NONE', 'ZIP', 'WAR', 'JAR'];
}

export function defaultArchiveFormat(
  sourceRootKey: RootKey,
  destinationRootKey: RootKey,
): FileMoveArchiveChoice {
  return isCrossRootArchiveRequired(sourceRootKey, destinationRootKey) ? 'ZIP' : 'NONE';
}

/**
 * Same-root as-is omits archiveFormat. Archiving / qc→techDrive sends explicit ZIP|WAR|JAR.
 * Never returns NONE for the wire payload.
 */
export function archiveFormatForRequest(
  choice: FileMoveArchiveChoice,
  sourceRootKey: RootKey,
  destinationRootKey: RootKey,
): 'ZIP' | 'WAR' | 'JAR' | undefined {
  if (isCrossRootArchiveRequired(sourceRootKey, destinationRootKey)) {
    return choice === 'NONE' ? 'ZIP' : choice;
  }
  if (choice === 'NONE') return undefined;
  return choice;
}

/** Preview basename after strip+append; for display only. Preflight remains authoritative. */
export function previewArchiveFileName(sourcePath: string, format: 'ZIP' | 'WAR' | 'JAR'): string {
  const base = normalizePath(sourcePath).split('/').pop() || sourcePath;
  const lower = base.toLowerCase();
  let stem = base;
  for (const suffix of ARCHIVE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      stem = base.slice(0, base.length - suffix.length);
      break;
    }
  }
  return `${stem}.${format.toLowerCase()}`;
}

export function fileMovePhaseLabel(phaseCode: string | null | undefined): string | null {
  if (!phaseCode) return null;
  switch (phaseCode) {
    case 'FILE_MOVE_STARTED':
      return 'Starting…';
    case 'FILE_MOVE_CREATING_TEMP':
      return 'Creating temp directory';
    case 'FILE_MOVE_ZIPPING':
      return 'Zipping';
    case 'FILE_MOVE_TRANSFERRING':
      return 'Transferring';
    case 'FILE_MOVE_DELETING_TEMP':
      return 'Deleting temp';
    case 'FILE_MOVE_ITEM_COMPLETED':
      return 'Item completed';
    case 'FILE_MOVE_ITEM_FAILED':
      return 'Item failed';
    default:
      return null;
  }
}

export function archiveFormatLabel(choice: FileMoveArchiveChoice): string {
  if (choice === 'NONE') return 'Move as-is';
  if (choice === 'ZIP') return 'Zip';
  if (choice === 'WAR') return 'War';
  return 'Jar';
}
