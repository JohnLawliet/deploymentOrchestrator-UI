import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type SearchableProfile = { id?: string; name?: string; profileName?: string | null };
type SearchableProfileSelectProps<T extends SearchableProfile> = {
  profiles?: T[];
  value?: string;
  onValueChange?: (value: string) => void;
  onSelect?: (profile: T) => void;
  getKey?: (profile: T) => string;
  getLabel?: (profile: T) => string;
  getDescription?: (profile: T) => string;
  getSearchText?: (profile: T) => string;
  isDisabled?: (profile: T) => boolean;
  getDisabledReason?: (profile: T) => string;
  ariaLabel?: string;
  inputAriaLabel?: string;
  placeholder?: string;
  inputPlaceholder?: string;
  groupLabel?: string;
  createOptionLabel?: string;
  onCreate?: (value: string) => void;
  onInputBlur?: () => void;
  createOptionDisabled?: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
  disabled?: boolean;
};

export default function SearchableProfileSelect<T extends SearchableProfile>({
  profiles = [],
  value = '',
  onValueChange,
  onSelect,
  getKey = (profile) => profile.id ?? '',
  getLabel = (profile) => profile.name ?? profile.profileName ?? profile.id ?? '',
  getDescription = (profile) => profile.id ?? '',
  getSearchText = (profile) => `${getLabel(profile)} ${getDescription(profile)}`,
  isDisabled = () => false,
  getDisabledReason = () => '',
  ariaLabel = 'Search profiles',
  inputAriaLabel = 'Profile name or ID',
  placeholder = 'Search profiles...',
  inputPlaceholder = 'Type a profile name or ID...',
  groupLabel = 'Profiles',
  createOptionLabel,
  onCreate,
  onInputBlur,
  createOptionDisabled = false,
  align = 'start',
  className = 'w-full justify-between font-normal sm:w-72',
  disabled = false,
}: SearchableProfileSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const normalizedQuery = value.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return profiles;
    return profiles.filter((profile) =>
      String(getSearchText(profile) || '')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [getSearchText, normalizedQuery, profiles]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={className}
          disabled={disabled}
        >
          <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={inputAriaLabel}
            placeholder={inputPlaceholder}
            value={value}
            onValueChange={onValueChange}
            onBlur={onInputBlur}
          />
          <CommandList>
            <CommandEmpty>{createOptionLabel ? 'Enter a valid value to continue.' : 'No matching profiles.'}</CommandEmpty>
            {createOptionLabel && (
              <>
                <CommandGroup>
                  <CommandItem
                    value={`create-${value}`}
                    disabled={createOptionDisabled}
                    onSelect={() => {
                      if (!createOptionDisabled) {
                        onCreate?.(value.trim());
                        setOpen(false);
                      }
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">{createOptionLabel}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {value && (
              <>
                <CommandGroup>
                  <CommandItem
                    value="clear-profile-search"
                    onSelect={() => {
                      onValueChange?.('');
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Clear selection
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading={groupLabel}>
              {suggestions.map((profile) => {
                const label = getLabel(profile);
                const description = getDescription(profile);
                const disabled = isDisabled(profile);
                const disabledReason = getDisabledReason(profile);
                return (
                  <CommandItem
                    key={getKey(profile)}
                    value={getSearchText(profile)}
                    disabled={disabled}
                    onSelect={() => {
                      if (!disabled) {
                        onSelect?.(profile);
                        setOpen(false);
                      }
                    }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${value === label ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="min-w-0">
                      <span className="block truncate">{label}</span>
                      {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
                      {disabledReason && <span className="block text-xs text-red-700">{disabledReason}</span>}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
