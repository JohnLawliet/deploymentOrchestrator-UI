import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePortal } from '@/context/PortalContext';

export default function OperationToastQueue() {
  const { operationToasts = [], dismissOperationToast } = usePortal();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {operationToasts.map((toast) => {
        const failed = toast.outcome === 'FAILED';
        const Icon = failed ? TriangleAlert : CheckCircle2;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-lg border p-3 shadow-lg ${failed ? 'border-amber-500/40 bg-amber-50 text-amber-950' : 'border-green-500/40 bg-green-50 text-green-950'}`}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.heading}</p>
                <p className="mt-1 break-words text-xs">
                  {toast.username} · {toast.targetLabel}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] opacity-75">Deployment ID: {toast.deploymentId}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Dismiss operation notification"
                onClick={() => dismissOperationToast?.(toast.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
