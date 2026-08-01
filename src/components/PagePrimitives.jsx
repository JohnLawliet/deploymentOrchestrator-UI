import { AlertCircle } from 'lucide-react'

export function Page({ title, description, children }) {
  return <div className="p-5 md:p-8 max-w-7xl mx-auto"><div className="mb-7"><h1 className="text-2xl font-bold">{title}</h1><p className="text-sm text-muted-foreground mt-1">{description}</p></div>{children}</div>
}

export function Field({ label, children }) {
  return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>
}

export function Choice({ label, value, onChange, yes, no }) {
  return <fieldset><legend className="text-sm font-medium mb-2">{label}</legend><div className="grid sm:grid-cols-2 gap-2">{[[true, yes], [false, no]].map(([option, text]) => <label key={String(option)} className={`choice ${value === option ? 'choice-active' : ''}`}><input type="radio" checked={value === option} onChange={() => onChange(option)} />{text}</label>)}</div></fieldset>
}

export function Notice({ children, tone = 'info' }) {
  return <div className={`notice notice-${tone}`}><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><div>{children}</div></div>
}
