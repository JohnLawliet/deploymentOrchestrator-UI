import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadAdditionalConfigSample, saveBlob } from '@/lib/contractApi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/types/frontend';

type AdditionalConfigRequiredFieldProps = {
  sourceLabel?: 'WAR' | 'archive';
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onCheckedChange: (checked: boolean) => void;
};

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 404;

export default function AdditionalConfigRequiredField({
  sourceLabel = 'WAR',
  checked,
  disabled = false,
  className,
  onCheckedChange,
}: AdditionalConfigRequiredFieldProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const downloadSample = async () => {
    setDownloading(true);
    setError('');
    try {
      saveBlob(await downloadAdditionalConfigSample());
    } catch (reason: unknown) {
      setError(
        isNotFound(reason)
          ? 'The additionalConfig sample is not available on the server.'
          : errorMessage(reason, 'Unable to download the additionalConfig sample.'),
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-md border', checked && 'border-primary bg-primary/10', className)}>
      <Label className="flex items-start gap-3 p-3">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <span>
          <strong>Apply additional {sourceLabel} configuration</strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            Require an additionalConfig.toml beside the selected {sourceLabel} for properties or web.xml changes. Leave unchecked
            when no additional changes are needed.
          </span>
        </span>
      </Label>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">Download sample file</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Download sample file"
          disabled={disabled || downloading}
          onClick={() => void downloadSample()}
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
      </div>
      {error ? <p className="px-3 pb-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
