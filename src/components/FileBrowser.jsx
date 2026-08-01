import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronRight, File, Folder, Home, Loader2, Lock, RefreshCw } from 'lucide-react'
import { listFiles } from '@/lib/contractApi'
import { Button } from '@/components/ui/button'

const joinRelative = (base, name) => base === '.' ? name : `${base.replace(/\\/g, '/')}/${name}`
const sortEntries = (items) => [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))

export default function FileBrowser({ rootKey, selectableExtension, selected = [], onSelectionChange, refreshToken = 0 }) {
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  const load = useCallback((signal) => {
    setLoading(true); setError('')
    listFiles(rootKey, path, signal).then((items) => setEntries(sortEntries(items))).catch((reason) => {
      if (reason.name !== 'CanceledError') setError(reason.message)
    }).finally(() => setLoading(false))
  }, [path, rootKey])

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort() }, [load, refresh, refreshToken])
  const crumbs = useMemo(() => path === '.' ? [] : path.split('/'), [path])
  const navigateCrumb = (index) => setPath(index < 0 ? '.' : crumbs.slice(0, index + 1).join('/'))
  const toggle = (relative, entry) => {
    const removing = selected.includes(relative)
    const next = removing ? selected.filter((item) => item !== relative) : [...selected, relative]
    onSelectionChange?.(next, { relative, entry, selected: !removing })
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/40 border-b border-border">
        <div className="flex items-center gap-1 flex-wrap text-xs">
          <button type="button" onClick={() => navigateCrumb(-1)} className="p-1 hover:text-primary"><Home className="w-3.5 h-3.5" /></button>
          {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className="flex items-center gap-1"><ChevronRight className="w-3 h-3 text-muted-foreground" /><button type="button" onClick={() => navigateCrumb(index)} className="hover:text-primary">{crumb}</button></span>)}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      {loading && <div className="py-12 flex justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading directory…</div>}
      {!loading && error && <div className="py-10 px-4 text-center text-sm text-red-700"><AlertCircle className="w-5 h-5 mx-auto mb-2" />{error}<div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setRefresh((v) => v + 1)}>Retry</Button></div></div>}
      {!loading && !error && entries.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">This directory is empty.</div>}
      {!loading && !error && entries.map((entry) => {
        const relative = joinRelative(path, entry.name)
        const isDirectory = entry.type === 'directory'
        const allowed = isDirectory || !selectableExtension || entry.name.toLowerCase().endsWith(selectableExtension)
        return <div key={relative} className={`flex items-center gap-3 px-3 py-2.5 border-t border-border first:border-t-0 ${allowed ? 'hover:bg-muted' : 'opacity-45'}`}>
          {onSelectionChange && <input type="checkbox" aria-label={`Select ${entry.name}`} checked={selected.includes(relative)} disabled={!allowed || (selectableExtension && isDirectory)} onChange={() => toggle(relative, entry)} />}
          <button type="button" disabled={!isDirectory} onClick={() => isDirectory && setPath(relative)} className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-default">
            {isDirectory ? <Folder className="w-4 h-4 text-amber-600 shrink-0" /> : <File className="w-4 h-4 text-blue-600 shrink-0" />}
            <span className="truncate text-sm">{entry.name}</span>
          </button>
          {entry.locked && <span title={entry.lockMode || 'Locked'}><Lock className="w-3.5 h-3.5 text-amber-600" /></span>}
          <span className="hidden sm:block w-28 text-right text-xs text-muted-foreground">{entry.lastModified ? new Date(entry.lastModified).toLocaleString() : '—'}</span>
          <span className="w-16 text-right text-xs text-muted-foreground">{isDirectory ? 'Folder' : formatSize(entry.size)}</span>
        </div>
      })}
    </div>
  )
}

function formatSize(bytes = 0) {
  if (!bytes) return '0 B'
  const unit = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / (1024 ** unit)).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit] || 'TB'}`
}
