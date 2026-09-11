import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArchiveRestore,
  CheckSquare,
  ChevronRight,
  File,
  Folder,
  FolderInput,
  Home,
  Loader2,
  Lock,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import {
  EXTRACTION_UNCONFIRMED_MESSAGE,
  type ApiRequestError,
  deleteFiles,
  extractFile,
  listFiles,
  renameFile,
} from '@/lib/contractApi';
import { Button } from '@/components/ui/button';
import LockNotice from '@/components/LockNotice';
import SearchableProfileSelect from '@/components/SearchableProfileSelect';
import { useOptionalPortal } from '@/context/PortalContext';
import { errorMessage } from '@/types/frontend';
import type { FileMoveResult, FileNode, RootKey } from '@/types/api-contracts';

const FileMoveDrawer = lazy(() => import('@/components/FileMoveDrawer'));

type SelectionChange =
  | { relative: string; entry: FileNode | undefined; selected: boolean }
  | { changes: Array<{ relative: string; entry: FileNode | undefined; selected: boolean }> };
type FileBrowserProps = {
  rootKey: RootKey;
  selectableExtension?: string | string[];
  selectableType?: 'any' | 'file' | 'directory';
  selected?: string[];
  onSelectionChange?: (selected: string[], change: SelectionChange) => void;
  refreshToken?: number;
  disabled?: boolean;
  showSelectAll?: boolean;
  enableMove?: boolean;
  enableDelete?: boolean;
  onPathChange?: (path: string) => void;
  /** Floor for navigation; Home and crumbs cannot go above this root-relative path. */
  basePath?: string;
};

const joinRelative = (base: string, name: string): string => (base === '.' ? name : `${base.replace(/\\/g, '/')}/${name}`);
const normalizeRelativePath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return !normalized || normalized === '.' ? '.' : normalized;
};
const sortEntries = (items: FileNode[]): FileNode[] =>
  [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
const archiveSuffixes = ['.tar.gz', '.zip', '.war', '.jar', '.7z'];
const isArchive = (entry: FileNode): boolean =>
  entry.type === 'file' && archiveSuffixes.some((suffix) => entry.name.toLocaleLowerCase().endsWith(suffix));

function extractionErrorMessage(reason: unknown): string {
  const error = reason as Partial<ApiRequestError>;
  if (!error.status) return EXTRACTION_UNCONFIRMED_MESSAGE;
  if (error.status === 413 || error.code === 'ARCHIVE_LIMIT_EXCEEDED')
    return 'The archive exceeds a server extraction limit.';
  if (error.status === 415 || error.code === 'UNSUPPORTED_ARCHIVE_FORMAT')
    return 'This archive format is unsupported or has been disabled by the server.';
  if (error.status === 422 || error.code === 'INVALID_ARCHIVE')
    return 'The archive is corrupt, unsafe, encrypted, or uses an unsupported variant.';
  if (error.code === 'ARCHIVE_CLEANUP_FAILED')
    return 'Temporary extraction output could not be completely deleted. Administrator attention is required.';
  return typeof error.message === 'string' && error.message ? error.message : errorMessage(reason, 'Unable to extract this archive.');
}

export default function FileBrowser({
  rootKey,
  selectableExtension,
  selectableType = 'any',
  selected = [],
  onSelectionChange,
  refreshToken = 0,
  disabled = false,
  showSelectAll = false,
  enableMove,
  enableDelete,
  onPathChange,
  basePath = '.',
}: FileBrowserProps) {
  const portal = useOptionalPortal();
  const floor = normalizeRelativePath(basePath);
  const [path, setPath] = useState(floor);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [extractingPath, setExtractingPath] = useState<string | null>(null);
  const [extractedPath, setExtractedPath] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<ApiRequestError | null>(null);
  const [extractionSuccess, setExtractionSuccess] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamedPaths, setRenamedPaths] = useState<Set<string>>(() => new Set());
  const [refresh, setRefresh] = useState(0);
  const [fileNameFilter, setFileNameFilter] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const knownEntries = useRef(new Map<string, FileNode>());
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (signal: AbortSignal) => {
      setLoading(true);
      setError('');
      listFiles(rootKey, path, signal)
        .then((items) => {
          const sorted = sortEntries(items);
          sorted.forEach((entry) => knownEntries.current.set(joinRelative(path, entry.name), entry));
          setEntries(sorted);
        })
        .catch((reason: unknown) => {
          if (!(reason instanceof Error && reason.name === 'CanceledError')) setError(errorMessage(reason));
        })
        .finally(() => setLoading(false));
    },
    [path, rootKey],
  );

  useEffect(() => {
    knownEntries.current.clear();
    setFileNameFilter('');
    setRenamedPaths(new Set());
    setPath(floor);
  }, [rootKey, floor]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refresh, refreshToken]);
  useEffect(() => {
    onPathChange?.(path);
  }, [path, onPathChange]);
  const crumbs = useMemo(() => {
    if (path === '.' || path === floor) return [];
    if (floor === '.') return path.split('/');
    if (!path.startsWith(`${floor}/`)) return [];
    return path.slice(floor.length + 1).split('/').filter(Boolean);
  }, [floor, path]);
  const filteredEntries = useMemo(() => {
    const normalizedFilter = fileNameFilter.trim().toLocaleLowerCase();
    if (!normalizedFilter) return entries;
    return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedFilter));
  }, [entries, fileNameFilter]);
  const firstSelectedRelative = useMemo(
    () => filteredEntries.map((entry) => joinRelative(path, entry.name)).find((relative) => selected.includes(relative)),
    [filteredEntries, path, selected],
  );
  useEffect(() => {
    if (loading || !firstSelectedRelative) return;
    const row = listRef.current?.querySelector(`[data-path="${CSS.escape(firstSelectedRelative)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [firstSelectedRelative, loading]);
  useEffect(() => {
    if (loading || !extractedPath) return;
    const row = listRef.current?.querySelector(`[data-path="${CSS.escape(extractedPath)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [extractedPath, loading]);
  const interactionDisabled = disabled || deleting || !!renamingPath || !!extractingPath || moveOpen;
  const mutatingRoot = rootKey === 'techDrive' || rootKey === 'qc';
  const supportsDelete = enableDelete ?? mutatingRoot;
  const supportsMove = (enableMove ?? false) && mutatingRoot;
  const supportsRename = true;
  const deleteLock = supportsDelete || supportsMove ? portal?.findConflictingLock?.({ section: 'FILE', profile: rootKey, mode: 'WRITE' }) : null;
  const entryDetails = (entry: FileNode) => {
    const isDirectory = entry.type === 'directory';
    const extensionAllowed =
      !selectableExtension ||
      (Array.isArray(selectableExtension) ? selectableExtension : [selectableExtension]).some((extension) =>
        entry.name.toLowerCase().endsWith(extension.toLowerCase()),
      );
    const typeAllowed =
      selectableType === 'directory'
        ? isDirectory
        : selectableType === 'file'
          ? !isDirectory && extensionAllowed
          : selectableExtension
            ? !isDirectory && extensionAllowed
            : true;
    return { isDirectory, selectionAllowed: typeAllowed && !entry.locked && !interactionDisabled };
  };
  const selectableVisibleEntries = entries.filter((entry) => entryDetails(entry).selectionAllowed);
  const allVisibleSelected =
    selectableVisibleEntries.length > 0 &&
    selectableVisibleEntries.every((entry) => selected.includes(joinRelative(path, entry.name)));
  const deletableSelections = selected.filter((relative) => {
    const entry = knownEntries.current.get(relative);
    return entry && !entry.locked;
  });
  const navigateCrumb = (index: number) => {
    setActionError('');
    setExtractionError(null);
    setExtractionSuccess('');
    setExtractedPath(null);
    setFileNameFilter('');
    if (index < 0) {
      setPath(floor);
      return;
    }
    const belowFloor = crumbs.slice(0, index + 1).join('/');
    setPath(floor === '.' ? belowFloor : `${floor}/${belowFloor}`);
  };
  const openDirectory = (relative: string) => {
    setActionError('');
    setExtractionError(null);
    setExtractionSuccess('');
    setExtractedPath(null);
    setFileNameFilter('');
    setPath(relative);
  };
  const toggle = (relative: string, entry: FileNode) => {
    const removing = selected.includes(relative);
    const next = removing ? selected.filter((item) => item !== relative) : [...selected, relative];
    onSelectionChange?.(next, { relative, entry, selected: !removing });
  };
  const selectAll = () => {
    const selectedSet = new Set(selected);
    const changes: Array<{ relative: string; entry: FileNode; selected: boolean }> = [];
    selectableVisibleEntries.forEach((entry) => {
      const relative = joinRelative(path, entry.name);
      if (allVisibleSelected) {
        selectedSet.delete(relative);
        changes.push({ relative, entry, selected: false });
      } else if (!selectedSet.has(relative)) {
        selectedSet.add(relative);
        changes.push({ relative, entry, selected: true });
      }
    });
    if (changes.length) onSelectionChange?.([...selectedSet], { changes });
  };
  const removeSelectedFiles = async () => {
    if (!deletableSelections.length || deleteLock) return;
    if (
      !window.confirm(
        `Permanently delete ${deletableSelections.length} selected item(s)? Directories and their contents will be removed. This action cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setActionError('');
    try {
      await deleteFiles(rootKey, deletableSelections);
      const deleted = new Set(deletableSelections);
      const changes = deletableSelections.map((relative) => ({
        relative,
        entry: knownEntries.current.get(relative),
        selected: false,
      }));
      onSelectionChange?.(
        selected.filter((relative) => !deleted.has(relative)),
        { changes },
      );
      deletableSelections.forEach((relative) => knownEntries.current.delete(relative));
      setRefresh((value) => value + 1);
    } catch (reason: unknown) {
      setActionError(errorMessage(reason));
    } finally {
      setDeleting(false);
    }
  };
  const renameEntry = async (entry: FileNode, relative: string, newName: string) => {
    if (renamingPath || interactionDisabled || entry.locked || !supportsRename) return;
    setRenamingPath(relative);
    setActionError('');
    try {
      await renameFile({ rootKey, path: relative, newName });
      const renamedRelative = joinRelative(path, newName);
      const renamedEntry = { ...entry, name: newName };
      setEntries((current) => sortEntries(current.map((item) => (item.name === entry.name ? renamedEntry : item))));
      knownEntries.current.delete(relative);
      knownEntries.current.set(renamedRelative, renamedEntry);
      setRenamedPaths((current) => {
        const next = new Set(current);
        next.delete(relative);
        next.add(renamedRelative);
        return next;
      });
      if (selected.includes(relative)) {
        const nextSelected = selected.map((item) => (item === relative ? renamedRelative : item));
        onSelectionChange?.(nextSelected, {
          changes: [
            { relative, entry, selected: false },
            { relative: renamedRelative, entry: renamedEntry, selected: true },
          ],
        });
      }
    } catch (reason: unknown) {
      setActionError(errorMessage(reason));
    } finally {
      setRenamingPath(null);
    }
  };
  const extractEntry = async (entry: FileNode, relative: string) => {
    if (extractingPath || interactionDisabled || entry.locked || !isArchive(entry)) return;
    setExtractingPath(relative);
    setActionError('');
    setExtractionError(null);
    setExtractionSuccess('');
    setExtractedPath(null);
    try {
      const result = await extractFile({ rootKey, path: relative });
      setExtractedPath(result.destinationPath);
      setExtractionSuccess(`Extracted to ${result.destinationPath}`);
      setRefresh((value) => value + 1);
    } catch (reason: unknown) {
      const requestError = reason as ApiRequestError;
      setExtractionError(requestError.status === 423 ? requestError : null);
      setActionError(extractionErrorMessage(reason));
      if (requestError.status === 404 || requestError.code === 'SOURCE_NOT_FOUND') setRefresh((value) => value + 1);
    } finally {
      setExtractingPath(null);
    }
  };
  const handleMoveFinished = (result: FileMoveResult | null) => {
    const moved = new Set((result?.completed || []).map((item) => item.sourcePath));
    if (moved.size && onSelectionChange) {
      const remaining = selected.filter((relative) => !moved.has(relative));
      const changes = selected
        .filter((relative) => moved.has(relative))
        .map((relative) => ({
          relative,
          entry: knownEntries.current.get(relative),
          selected: false,
        }));
      onSelectionChange(remaining, { changes });
      moved.forEach((relative) => knownEntries.current.delete(relative));
    }
    setRefresh((value) => value + 1);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/40 border-b border-border">
        <div className="flex items-center gap-1 flex-wrap text-xs">
          <button
            type="button"
            aria-label="Go to root directory"
            disabled={interactionDisabled}
            onClick={() => navigateCrumb(-1)}
            className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <button
                type="button"
                disabled={interactionDisabled}
                onClick={() => navigateCrumb(index)}
                className="hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1 flex-wrap">
          <SearchableProfileSelect<FileNode>
            profiles={entries}
            value={fileNameFilter}
            onValueChange={setFileNameFilter}
            onSelect={(entry) => setFileNameFilter(entry.name)}
            getKey={(entry) => joinRelative(path, entry.name)}
            getLabel={(entry) => entry.name}
            getDescription={(entry) => (entry.type === 'directory' ? 'Folder' : 'File')}
            getSearchText={(entry) => entry.name}
            ariaLabel="Filter files and folders"
            inputAriaLabel="Filter files and folders by name"
            placeholder="Filter files..."
            inputPlaceholder="Type a file or folder name..."
            groupLabel="Files and folders"
            className="w-44 justify-between font-normal sm:w-56"
            disabled={interactionDisabled || loading || !!error}
          />
          {showSelectAll && supportsDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={interactionDisabled || loading || !!error || !selectableVisibleEntries.length}
              onClick={selectAll}
            >
              {allVisibleSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
              {allVisibleSelected ? 'Unselect all' : 'Select all'}
            </Button>
          )}
          {supportsMove && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={interactionDisabled || !deletableSelections.length || !!deleteLock}
              onClick={() => {
                setActionError('');
                setMoveOpen(true);
              }}
            >
              <FolderInput className="w-3.5 h-3.5" />
              Move
            </Button>
          )}
          {supportsDelete && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5"
              disabled={interactionDisabled || !deletableSelections.length || !!deleteLock}
              onClick={removeSelectedFiles}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          {/* <Button
            type="button"
            aria-label="Refresh directory"
            variant="ghost"
            size="sm"
            disabled={interactionDisabled}
            onClick={() => {
              setActionError('');
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button> */}
        </div>
      </div>
      <LockNotice lock={deleteLock} />
      {extractionSuccess && (
        <div role="status" className="border-b border-border bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {extractionSuccess}
        </div>
      )}
      {actionError && (
        <div role="alert" className="border-b border-border bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {actionError}
          </div>
          {extractionError?.users?.length ? <div className="mt-1">Users: {extractionError.users.join(', ')}</div> : null}
          {extractionError?.paths?.length ? <div className="mt-1 font-mono text-xs">{extractionError.paths.join(', ')}</div> : null}
        </div>
      )}
      <div ref={listRef} data-testid="file-browser-list" className="max-h-[500px] overflow-y-auto">
        {loading && (
          <div className="py-12 flex justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading directory…
          </div>
        )}
        {!loading && error && (
          <div className="py-10 px-4 text-center text-sm text-red-700">
            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
            {error}
            <div>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setRefresh((v) => v + 1)}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">This directory is empty.</div>
        )}
        {!loading && !error && entries.length > 0 && filteredEntries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No matching files or folders.</div>
        )}
        {!loading &&
          !error &&
          filteredEntries.map((entry) => {
            const relative = joinRelative(path, entry.name);
            const { isDirectory, selectionAllowed } = entryDetails(entry);
            const visuallyAllowed = isDirectory || selectionAllowed;
            const extractable = isArchive(entry);
            return (
              <div
                key={relative}
                data-path={relative}
                className={`flex items-center gap-3 px-3 py-2.5 border-t border-border first:border-t-0 ${
                  extractedPath === relative ? 'bg-emerald-50' : visuallyAllowed ? 'hover:bg-muted' : 'opacity-45'
                }`}
              >
                {onSelectionChange && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${entry.name}`}
                    checked={selected.includes(relative)}
                    disabled={!selectionAllowed}
                    onChange={() => toggle(relative, entry)}
                  />
                )}
                <div
                  role="button"
                  tabIndex={isDirectory && !interactionDisabled ? 0 : undefined}
                  aria-label={entry.name}
                  aria-disabled={!isDirectory || interactionDisabled}
                  onClick={() => {
                    if (isDirectory) openDirectory(relative);
                  }}
                  onKeyDown={(event) => {
                    if (isDirectory && !interactionDisabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      openDirectory(relative);
                    }
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
                    isDirectory && !interactionDisabled ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {isDirectory ? (
                    <Folder className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <File className="w-4 h-4 text-blue-600 shrink-0" />
                  )}
                  <InlineRename
                    name={entry.name}
                    isDirectory={isDirectory}
                    canRename={supportsRename && !entry.locked && !interactionDisabled}
                    isRenaming={renamingPath === relative}
                    wasRenamed={renamedPaths.has(relative)}
                    onRename={(newName) => renameEntry(entry, relative, newName)}
                  />
                </div>
                {entry.locked && (
                  <span title={entry.lockMode || 'Locked'}>
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                  </span>
                )}
                {extractable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-xs lg:w-auto lg:gap-1 lg:px-2"
                    aria-label={`${extractingPath === relative ? 'Extracting' : 'Extract here'} ${entry.name}`}
                    title={extractingPath === relative ? 'Extracting…' : 'Extract here'}
                    disabled={interactionDisabled || entry.locked}
                    onClick={() => void extractEntry(entry, relative)}
                  >
                    {extractingPath === relative ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden lg:inline">{extractingPath === relative ? 'Extracting…' : 'Extract here'}</span>
                  </Button>
                )}
                <span className="hidden sm:block w-28 text-right text-xs text-muted-foreground">
                  {entry.lastModified ? new Date(entry.lastModified).toLocaleString() : '—'}
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">
                  {isDirectory ? 'Folder' : formatSize(entry.size)}
                </span>
              </div>
            );
          })}
      </div>
      {supportsMove && moveOpen && (
        <Suspense fallback={null}>
          <FileMoveDrawer
            open={moveOpen}
            sourceRootKey={rootKey}
            sourcePaths={deletableSelections}
            onClose={() => setMoveOpen(false)}
            onFinished={handleMoveFinished}
          />
        </Suspense>
      )}
    </div>
  );
}

type InlineRenameProps = {
  name: string;
  isDirectory: boolean;
  canRename: boolean;
  isRenaming: boolean;
  wasRenamed: boolean;
  onRename: (newName: string) => Promise<void>;
};

function InlineRename({ name, isDirectory, canRename, isRenaming, wasRenamed, onRename }: InlineRenameProps) {
  const extension = isDirectory ? '' : fileExtension(name);
  const baseName = extension ? name.slice(0, -extension.length) : name;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseName);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(baseName);
  }, [baseName, editing]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const submit = () => {
    if (submitting.current) return;
    const newName = draft.trim();
    setEditing(false);
    if (`${newName}${extension}` === name) return;
    if (!newName || newName === '.' || newName === '..' || /[\\/]/.test(newName)) return;
    submitting.current = true;
    void onRename(`${newName}${extension}`).finally(() => {
      submitting.current = false;
    });
  };

  if (isRenaming) return <span className="shrink-0 text-sm text-muted-foreground">...renaming...</span>;
  if (editing) {
    return (
      <span className="inline-flex items-center">
        <input
          ref={inputRef}
          type="text"
          aria-label={`Rename ${name}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={submit}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="max-w-full rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {extension && <span className="shrink-0 text-sm text-muted-foreground">{extension}</span>}
      </span>
    );
  }
  return (
    <span
      aria-disabled={!canRename}
      onClick={(event) => {
        event.stopPropagation();
        if (canRename) setEditing(true);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`shrink-0 truncate text-sm ${canRename ? 'cursor-text' : ''} ${wasRenamed ? 'text-blue-600' : ''}`}
      title={canRename ? 'Rename' : undefined}
    >
      {name}
    </span>
  );
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function formatSize(bytes = 0): string {
  if (!bytes) return '0 B';
  const unit = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit] || 'TB'}`;
}
