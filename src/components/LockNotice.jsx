import { LockKeyhole } from 'lucide-react';
import { Notice } from '@/components/PagePrimitives';

export default function LockNotice({ lock }) {
  if (!lock) return null;
  return (
    <Notice tone="warning">
      <div className="flex items-start gap-2">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <strong>Locked by {lock.owner}</strong>
          <div>{[lock.reason, lock.section, lock.profile].filter(Boolean).join(' · ')}</div>
          {lock.expiresAt && <div className="mt-1 text-xs">Expires {new Date(lock.expiresAt).toLocaleString()}</div>}
        </div>
      </div>
    </Notice>
  );
}
