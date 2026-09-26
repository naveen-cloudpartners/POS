export interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  filters: Array<{
    key: string;
    value: string;
    options: Array<FilterOption>;
    ariaLabel: string;
    onChange: (value: string) => void;
  }>;
  onReset?: () => void;
}

export default function FilterBar({ filters, onReset }: FilterBarProps) {
  return (
    <div className="ch-filterbar">
      {filters.map((f) => (
        <select
          key={f.key}
          className="ch-select"
          aria-label={f.ariaLabel}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {onReset !== undefined && (
        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={onReset}>
          Reset
        </button>
      )}
    </div>
  );
}
