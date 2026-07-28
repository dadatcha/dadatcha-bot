import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type FieldRowProps = {
  label: string;
  hint?: string;
  children: React.ReactNode;
};

export function FieldRow({ label, hint, children }: FieldRowProps) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0 w-40">
        {children}
      </div>
    </div>
  );
}

type NumberFieldProps = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
};

export function NumberField({ value, onChange, min, max, suffix }: NumberFieldProps) {
  return (
    <div className="relative">
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono text-sm pr-12"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}
