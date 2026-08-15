import { useEffect } from 'react';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BACKEND_OFFLINE_TOAST } from '@/lib/contractApi';
import { usePortal } from '@/context/PortalContext';
import type { SystemToast } from '@/types/frontend';

const AUTO_DISMISS_MS = 5000;

function Toast({ toast, onDismiss }: { toast: SystemToast; onDismiss: (id: string) => void }) {
  const persist = toast.message === BACKEND_OFFLINE_TOAST;
  useEffect(() => {
    if (persist) return undefined;
    const timeout = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, persist, toast.id]);

  const warning = toast.variant === 'warning';
  const Icon = warning ? TriangleAlert : CheckCircle2;
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-lg border p-3 shadow-lg ${
        warning ? 'border-amber-500/40 bg-amber-50 text-amber-950' : 'border-green-500/40 bg-green-50 text-green-950'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words text-sm">{toast.message}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Dismiss system notification"
          onClick={() => onDismiss(toast.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function SystemToastQueue() {
  const { systemToasts = [], dismissSystemToast } = usePortal();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {systemToasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissSystemToast} />
      ))}
    </div>
  );
}
