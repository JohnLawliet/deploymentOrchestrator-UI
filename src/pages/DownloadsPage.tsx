import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import {
  downloadSingle,
  isLockConflict,
  getFileRoots,
  listPreparedDownloads,
  prepareArchiveDownload,
  saveBlob,
  startPreparedArchiveTransfer,
} from '@/lib/contractApi';
import { usePortal } from '@/context/PortalContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice, Page } from '@/components/PagePrimitives';
import LockNotice from '@/components/LockNotice';
import PageTutorial from '@/components/PageTutorial';
import type { DownloadArchiveView, FileRoot } from '@/types/api-contracts';
import { downloadsTutorialSteps } from '@/lib/pageTutorials';

function formatArchiveSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function canRetryArchive(status: DownloadArchiveView['status']): boolean {
  return status === 'READY' || status === 'UNFINISHED';
}

export default function DownloadsPage() {
  const { lastSystemEvent, findConflictingLock } = usePortal();
  const [roots, setRoots] = useState<FileRoot[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionTypes, setSelectionTypes] = useState<Record<string, 'file' | 'directory'>>({});
  const [downloading, setDownloading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [archives, setArchives] = useState<DownloadArchiveView[]>([]);
  const [archivesError, setArchivesError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    getFileRoots().then(setRoots).catch(setError);
  }, []);
  useEffect(() => {
    listPreparedDownloads().then(setArchives).catch(setArchivesError);
  }, [refreshToken]);
  useEffect(() => {
    if (!lastSystemEvent || !('eventType' in lastSystemEvent)) return;
    const lifecycle = ['RESOURCE_ACTIVE', 'RESOURCE_FAILED', 'RESOURCE_INACTIVE'].includes(lastSystemEvent.eventType);
    const fileCompletion =
      lastSystemEvent.eventType === 'OPERATION_FINISHED' &&
      lastSystemEvent.resources?.section === 'FILE' &&
      (lastSystemEvent.resources?.resourceKey || lastSystemEvent.resourceKey) === 'FILE:qc';
    const lockChanged = lastSystemEvent.eventType === 'LOCK_CHANGED';
    if (lifecycle || fileCompletion || lockChanged) setRefreshToken((v) => v + 1);
  }, [lastSystemEvent]);
  const downloadLock = findConflictingLock?.({ section: 'DOWNLOAD', profile: 'qc', mode: 'READ' });
  const lockError = isLockConflict(error) ? error : null;
  const errorText = error instanceof Error ? error.message : error === null ? '' : String(error);
  const archivesErrorText =
    archivesError instanceof Error ? archivesError.message : archivesError === null ? '' : String(archivesError);
  const busy = downloading || preparing;

  const refreshArchives = () => {
    setArchivesError(null);
    setRefreshToken((v) => v + 1);
  };

  const download = async () => {
    if (!selected.length) return;
    if (downloadLock) return;
    const singleFile = selected.length === 1 && selectionTypes[selected[0]] === 'file';
    setError(null);
    if (singleFile) setDownloading(true);
    else setPreparing(true);
    try {
      if (singleFile) saveBlob(await downloadSingle('qc', selected[0]));
      else {
        const prepared = await prepareArchiveDownload('qc', selected);
        startPreparedArchiveTransfer(prepared.downloadToken);
        refreshArchives();
      }
      setSelected([]);
      setSelectionTypes({});
    } catch (e: unknown) {
      setError(e);
    } finally {
      setDownloading(false);
      setPreparing(false);
    }
  };

  return (
    <Page
      title="Download files"
      description="Browse within the QC filesystem root and download a single file, or prepare a ZIP for directories and multiple items."
      headerAction={<PageTutorial steps={downloadsTutorialSteps} />}
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>QC file browser</CardTitle>
              <CardDescription className="mt-1">
                {roots?.find((root) => root.key === 'qc')
                  ? `Root: ${roots.find((root) => root.key === 'qc')?.path || 'QC filesystem'}`
                  : 'Loading exposed roots…'}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshArchives}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lockError && (
            <Notice tone="warning">
              <strong>Resource currently locked</strong>
              <div>{lockError.message}</div>
              {lockError.users.length > 0 && <div className="mt-1">Users: {lockError.users.join(', ')}</div>}
              {lockError.paths.length > 0 && (
                <ul className="font-mono text-xs mt-2">
                  {lockError.paths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
              <Button variant="outline" size="sm" className="mt-3" onClick={download}>
                Retry download
              </Button>
            </Notice>
          )}
          {Boolean(error) && !lockError && (
            <Notice tone="error">
              <div>{errorText}</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={download}>
                Retry download
              </Button>
            </Notice>
          )}
          <LockNotice lock={downloadLock} />
          <div data-tour="download-browser">
            <FileBrowser
              rootKey="qc"
              showSelectAll
              enableMove
              selected={selected}
              onSelectionChange={(items, change) => {
                setSelected(items);
                setSelectionTypes((current) => {
                  const next = { ...current };
                  const changes = 'changes' in change ? change.changes : [change];
                  changes.forEach((item) => {
                    if (item.selected && item.entry) next[item.relative] = item.entry.type;
                    else delete next[item.relative];
                  });
                  return next;
                });
              }}
              refreshToken={refreshToken}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3" data-tour="download-action">
            <p className="text-sm text-muted-foreground">
              {selected.length
                ? `${selected.length} item(s) selected. Directories or multiple items are prepared as qc-download.zip, then the browser downloads the archive.`
                : 'Select one or more files or directories.'}
            </p>
            <Button className="gap-2" disabled={!selected.length || busy || !!downloadLock} onClick={download}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {preparing ? 'Preparing download...' : downloading ? 'Downloading…' : 'Download selection'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Prepared archives</CardTitle>
          <CardDescription>
            READY and UNFINISHED zips can be retried with the same download URL. Do not prepare again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Boolean(archivesError) && <Notice tone="error">{archivesErrorText}</Notice>}
          {!archives.length && !archivesError ? (
            <p className="text-sm text-muted-foreground">No prepared archives for this user.</p>
          ) : (
            <ul className="space-y-2">
              {archives.map((archive) => (
                <li
                  key={archive.downloadToken}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{archive.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {archive.status} · {formatArchiveSize(archive.size)} · {new Date(archive.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRetryArchive(archive.status)}
                    onClick={() => startPreparedArchiveTransfer(archive.downloadToken)}
                  >
                    Retry
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
