import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  ChevronRight,
  File,
  Folder,
  Home,
  Loader2,
  Lock,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { deleteFiles, listFiles, renameFile } from '@/lib/contractApi';
import { Button } from '@/components/ui/button';
import LockNotice from '@/components/LockNotice';
import SearchableProfileSelect from '@/components/SearchableProfileSelect';
import { useOptionalPortal } from '@/context/PortalContext';
import { errorMessage } from '@/types/frontend';
import type { FileNode, RootKey } from '@/types/api-contracts';

type SelectionChange =
  | { relative: string; entry: FileNode | undefined; selected: boolean }
  | { changes: Array<{ relative: string; entry: FileNode | undefined; selected: boolean }> };
type FileBrowserProps = {
  rootKey: RootKey;
  selectableExtension?: string;
  selectableType?: 'any' | 'file' | 'directory';
  selected?: string[];
  onSelectionChange?: (selected: string[], change: SelectionChange) => void;
  refreshToken?: number;
  disabled?: boolean;
  showSelectAll?: boolean;
};

const joinRelative = (base: string, name: string): string => (base === '.' ? name : `${base.replace(/\\/g, '/')}/${name}`);
const sortEntries = (items: FileNode[]): FileNode[] =>
  [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));

export default function FileBrowser({
  rootKey,
  selectableExtension,
  selectableType = 'any',
  selected = [],
  onSelectionChange,
  refreshToken = 0,
  disabled = false,
  showSelectAll = false,
}: FileBrowserProps) {
  const portal = useOptionalPortal();
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamedPaths, setRenamedPaths] = useState<Set<string>>(() => new Set());
  const [refresh, setRefresh] = useState(0);
  const [fileNameFilter, setFileNameFilter] = useState('');
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
  }, [rootKey]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refresh, refreshToken]);
  const crumbs = useMemo(() => (path === '.' ? [] : path.split('/')), [path]);
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
  const interactionDisabled = disabled || deleting || !!renamingPath;
  const supportsDelete = rootKey === 'techDrive' || rootKey === 'qc';
  const supportsRename = true;
  const deleteLock = supportsDelete ? portal?.findConflictingLock?.({ section: 'FILE', profile: rootKey, mode: 'WRITE' }) : null;
  const entryDetails = (entry: FileNode) => {
    const isDirectory = entry.type === 'directory';
    const extensionAllowed = !selectableExtension || entry.name.toLowerCase().endsWith(selectableExtension.toLowerCase());
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
    setFileNameFilter('');
    setPath(index < 0 ? '.' : crumbs.slice(0, index + 1).join('/'));
  };
  const openDirectory = (relative: string) => {
    setActionError('');
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
          <Button
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
          </Button>
        </div>
      </div>
      <LockNotice lock={deleteLock} />
      {actionError && (
        <div role="alert" className="flex items-center gap-2 border-b border-border bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
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
            return (
              <div
                key={relative}
                data-path={relative}
                className={`flex items-center gap-3 px-3 py-2.5 border-t border-border first:border-t-0 ${visuallyAllowed ? 'hover:bg-muted' : 'opacity-45'}`}
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
