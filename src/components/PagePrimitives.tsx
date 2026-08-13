import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Page({
  title,
  description,
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-5 md:p-8 max-w-8xl mx-auto">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-3" data-tour="page-header">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Choice({
  label,
  value,
  onChange,
  yes,
  no,
  yesDataTour,
  noDataTour,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yes: ReactNode;
  no: ReactNode;
  yesDataTour?: string;
  noDataTour?: string;
  disabled?: boolean;
}) {
  const choices: Array<[boolean, ReactNode]> = [
    [true, yes],
    [false, no],
  ];
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium mb-2">{label}</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {choices.map(([option, text]) => (
          <label
            key={String(option)}
            className={`choice ${value === option ? 'choice-active' : ''}`}
            data-tour={option ? yesDataTour : noDataTour}
          >
            <input type="radio" checked={value === option} onChange={() => onChange(option)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' | 'success' }) {
  return (
    <div className={`notice notice-${tone}`}>
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
