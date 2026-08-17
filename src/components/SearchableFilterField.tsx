import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

type SearchableFilterFieldProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
};

export default function SearchableFilterField({
  label,
  value,
  onValueChange,
  options,
  placeholder = 'Any',
  disabled = false,
}: SearchableFilterFieldProps) {
  const [open, setOpen] = useState(false);
  const normalizedQuery = value.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, options]);

  return (
    <div className="flex items-start gap-2">
      <label className="flex h-8 w-36 shrink-0 items-center text-xs font-medium text-muted-foreground">{label}:</label>
      <div
        className="min-w-0 flex-1"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <div className="relative">
          <Input
            aria-label={`Filter by ${label}`}
            aria-expanded={open}
            role="combobox"
            disabled={disabled}
            placeholder={placeholder}
            value={value}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              onValueChange(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
            className="h-8 pr-14 text-xs"
          />
          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5">
            {value ? (
              <button
                type="button"
                tabIndex={-1}
                className="pointer-events-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                disabled={disabled}
                aria-label={`Clear ${label} filter`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onValueChange('');
                  setOpen(true);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </div>
        </div>
        {open ? (
          <ul
            role="listbox"
            aria-label={`${label} values`}
            className="mt-1 max-h-28 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-sm"
          >
            {suggestions.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {normalizedQuery ? 'No matching values.' : 'No values available.'}
              </li>
            ) : (
              suggestions.map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === option}
                    disabled={disabled}
                    className="flex w-full items-center px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onValueChange(option);
                      setOpen(false);
                    }}
                  >
                    <Check className={`mr-2 h-3.5 w-3.5 shrink-0 ${value === option ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="min-w-0 truncate">{option}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
