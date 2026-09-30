import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export default function SearchBar({ value, onChange, placeholder = 'Search…', ariaLabel = 'Search' }: SearchBarProps) {
  return (
    <div className="ch-search purchase-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
