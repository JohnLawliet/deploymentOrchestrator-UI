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
import { deleteFiles, listFiles } from '@/lib/contractApi';
import { Button } from '@/components/ui/button';
import LockNotice from '@/components/LockNotice';
import { useOptionalPortal } from '@/context/PortalContext';

const joinRelative = (base, name) => (base === '.' ? name : `${base.replace(/\\/g, '/')}/${name}`);
const sortEntries = (items) =>
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
}) {
  const portal = useOptionalPortal();
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const knownEntries = useRef(new Map());

  const load = useCallback(
    (signal) => {
      setLoading(true);
      setError('');
      listFiles(rootKey, path, signal)
        .then((items) => {
          const sorted = sortEntries(items);
          sorted.forEach((entry) => knownEntries.current.set(joinRelative(path, entry.name), entry));
          setEntries(sorted);
        })
        .catch((reason) => {
          if (reason.name !== 'CanceledError') setError(reason.message);
        })
        .finally(() => setLoading(false));
    },
    [path, rootKey],
  );

  useEffect(() => {
    knownEntries.current.clear();
  }, [rootKey]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refresh, refreshToken]);
  const crumbs = useMemo(() => (path === '.' ? [] : path.split('/')), [path]);
  const interactionDisabled = disabled || deleting;
  const supportsDelete = rootKey === 'techDrive' || rootKey === 'qc';
  const deleteLock = supportsDelete ? portal?.findConflictingLock?.({ section: 'FILE', profile: rootKey, mode: 'WRITE' }) : null;
  const entryDetails = (entry) => {
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
  const navigateCrumb = (index) => {
    setActionError('');
    setPath(index < 0 ? '.' : crumbs.slice(0, index + 1).join('/'));
  };
  const toggle = (relative, entry) => {
    const removing = selected.includes(relative);
    const next = removing ? selected.filter((item) => item !== relative) : [...selected, relative];
    onSelectionChange?.(next, { relative, entry, selected: !removing });
  };
  const selectAll = () => {
    const selectedSet = new Set(selected);
    const changes = [];
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
    } catch (reason) {
      setActionError(reason.message || String(reason));
    } finally {
      setDeleting(false);
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
        <div className="flex items-center gap-1">
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
      {!loading &&
        !error &&
        entries.map((entry) => {
          const relative = joinRelative(path, entry.name);
          const { isDirectory, selectionAllowed } = entryDetails(entry);
          const visuallyAllowed = isDirectory || selectionAllowed;
          return (
            <div
              key={relative}
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
              <button
                type="button"
                disabled={!isDirectory || interactionDisabled}
                onClick={() => {
                  if (isDirectory) {
                    setActionError('');
                    setPath(relative);
                  }
                }}
                className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-default"
              >
                {isDirectory ? (
                  <Folder className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-blue-600 shrink-0" />
                )}
                <span className="truncate text-sm">{entry.name}</span>
              </button>
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
  );
}

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const unit = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit] || 'TB'}`;
}
