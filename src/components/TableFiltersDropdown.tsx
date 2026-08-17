import { Filter } from 'lucide-react';
import SearchableFilterField from '@/components/SearchableFilterField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type TableFilterField = {
  key: string;
  label: string;
  options: string[];
};

type TableFiltersDropdownProps = {
  filters: TableFilterField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  disabled?: boolean;
};

export default function TableFiltersDropdown({
  filters,
  values,
  onChange,
  onClear,
  disabled = false,
}: TableFiltersDropdownProps) {
  if (filters.length === 0) return null;

  const activeCount = filters.reduce((count, filter) => count + (values[filter.key]?.trim() ? 1 : 0), 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          aria-label={activeCount ? `Filters (${activeCount} active)` : 'Filters'}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 ? (
            <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px]">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Filters</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled || activeCount === 0}
            onClick={onClear}
          >
            Clear all
          </Button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto p-1">
          {filters.map((filter) => (
            <SearchableFilterField
              key={filter.key}
              label={filter.label}
              value={values[filter.key] || ''}
              options={filter.options}
              disabled={disabled}
              placeholder="Any"
              onValueChange={(value) => onChange(filter.key, value)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
