import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export default function Breadcrumbs({ items }: { items: Array<Crumb> }) {
  return (
    <nav className="ch-crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <Fragment key={`${c.label}-${i}`}>
          {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
          {c.to !== undefined && i < items.length - 1 ? (
            <Link to={c.to}>{c.label}</Link>
          ) : (
            <span className="current">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
