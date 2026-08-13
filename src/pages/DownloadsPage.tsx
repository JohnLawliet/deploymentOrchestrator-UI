import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import { downloadSelection, downloadSingle, getFileRoots, isLockConflict, saveBlob } from '@/lib/contractApi';
import { usePortal } from '@/context/PortalContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice, Page } from '@/components/PagePrimitives';
import LockNotice from '@/components/LockNotice';
import PageTutorial from '@/components/PageTutorial';
import type { FileRoot } from '@/types/api-contracts';
import { downloadsTutorialSteps } from '@/lib/pageTutorials';

export default function DownloadsPage() {
  const { lastSystemEvent, findConflictingLock } = usePortal();
  const [roots, setRoots] = useState<FileRoot[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionTypes, setSelectionTypes] = useState<Record<string, 'file' | 'directory'>>({});
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    getFileRoots().then(setRoots).catch(setError);
  }, []);
  useEffect(() => {
    if (!lastSystemEvent || !('eventType' in lastSystemEvent)) return;
    const lifecycle = ['RESOURCE_ACTIVE', 'RESOURCE_FAILED', 'RESOURCE_INACTIVE'].includes(lastSystemEvent.eventType);
    const fileCompletion =
      lastSystemEvent.eventType === 'OPERATION_FINISHED' &&
      lastSystemEvent.resources?.section === 'FILE' &&
      (lastSystemEvent.resources?.resourceKey || lastSystemEvent.resourceKey) === 'FILE:qc';
    if (lifecycle || fileCompletion) setRefreshToken((v) => v + 1);
  }, [lastSystemEvent]);
  const downloadLock = findConflictingLock?.({ section: 'DOWNLOAD', profile: 'qc', mode: 'READ' });
  const lockError = isLockConflict(error) ? error : null;
  const errorText = error instanceof Error ? error.message : error === null ? '' : String(error);

  const download = async () => {
    if (!selected.length) return;
    if (downloadLock) return;
    setDownloading(true);
    setError(null);
    try {
      const result =
        selected.length === 1 && selectionTypes[selected[0]] === 'file'
          ? await downloadSingle('qc', selected[0])
          : await downloadSelection('qc', selected);
      saveBlob(result);
      setSelected([]);
      setSelectionTypes({});
    } catch (e: unknown) {
      setError(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page
      title="Download files"
      description="Browse within the QC filesystem root and download files or streamed ZIP selections."
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
            <Button variant="outline" size="sm" onClick={() => setRefreshToken((v) => v + 1)}>
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
          {Boolean(error) && !lockError && <Notice tone="error">{errorText}</Notice>}
          <LockNotice lock={downloadLock} />
          <div data-tour="download-browser">
            <FileBrowser
              rootKey="qc"
              showSelectAll
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
                ? `${selected.length} item(s) selected. Multiple items are returned as qc-download.zip.`
                : 'Select one or more files or directories.'}
            </p>
            <Button className="gap-2" disabled={!selected.length || downloading || !!downloadLock} onClick={download}>
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloading ? 'Preparing download…' : 'Download selection'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
