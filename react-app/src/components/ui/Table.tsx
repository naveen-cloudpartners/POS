import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
  /** Optional fixed width (e.g. '110px') applied to both th and td. */
  width?: string;
}

interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: Array<T>;
  rowKey: (row: T, index: number) => string | number;
  minWidth?: number;
  /** Optional row-level class (e.g. low-stock highlighting). */
  rowClassName?: (row: T, index: number) => string | undefined;
}

export default function Table<T>({ columns, rows, rowKey, minWidth = 640, rowClassName }: TableProps<T>) {
  return (
    <div className="ch-table-wrap">
      <table className="ch-table" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric === true ? 'num' : undefined} scope="col" style={c.width !== undefined ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className={rowClassName?.(row, i) ?? undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric === true ? 'num' : undefined} style={c.width !== undefined ? { width: c.width } : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
