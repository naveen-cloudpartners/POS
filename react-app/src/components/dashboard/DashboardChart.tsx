import { useEffect, useId, useRef, useState } from 'react';
import type { DailyDashboardPoint } from '../../utils/dashboardAnalytics';
import { currency } from '../../utils/format';

type ChartKind = 'sales' | 'revenue' | 'orders';
interface Props { kind: ChartKind; points: DailyDashboardPoint[] }
const H = 180, LEFT = 48, RIGHT = 18, TOP = 12, BOTTOM = 28;
const PH = H - TOP - BOTTOM;
const compact = (v: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export default function DashboardChart({ kind, points }: Props) {
  const id = useId().replace(/:/g, '');
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(620);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const W = width;
  const PW = W - LEFT - RIGHT;
  const isMoney = kind !== 'orders';
  const first = points.map(p => kind === 'sales' ? p.revenue : kind === 'revenue' ? p.cumulativeRevenue : p.orders);
  const second = points.map(p => kind === 'sales' ? p.previousRevenue : kind === 'revenue' ? p.previousCumulativeRevenue : p.unpaidOrders);
  const rawMax = Math.max(0, ...first, ...second);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rawMax)));
  const maximum = !isMoney ? Math.max(4, Math.ceil(rawMax / 4) * 4) : rawMax === 0 ? 100 : Math.ceil(rawMax / magnitude) * magnitude;
  const step = PW / Math.max(1, points.length);
  const x = (i: number) => LEFT + step * (i + .5);
  const currentX = (i: number) => x(i) - (kind === 'sales' ? step * .175 : 0);
  const y = (value: number) => TOP + PH - Math.max(0, value) / maximum * PH;
  const line = (values: number[]) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${currentX(i)},${y(v)}`).join(' ');
  // Horizontal tangent controls keep curves inside each pair of real values.
  const smoothLine = (values: number[]) => values.map((v, i) => i === 0 ? `M${x(i)},${y(v)}` : `C${(x(i - 1) + x(i)) / 2},${y(values[i - 1])} ${(x(i - 1) + x(i)) / 2},${y(v)} ${x(i)},${y(v)}`).join(' ');
  const seriesLine = (values: number[]) => kind === 'orders' ? smoothLine(values) : line(values);
  const area = (values: number[]) => `${seriesLine(values)} L${x(values.length - 1)},${TOP + PH} L${x(0)},${TOP + PH} Z`;
  const meanX = (first.length - 1) / 2;
  const meanY = first.reduce((sum, value) => sum + value, 0) / Math.max(1, first.length);
  const denominator = first.reduce((sum, _, i) => sum + (i - meanX) ** 2, 0);
  const slope = denominator === 0 ? 0 : first.reduce((sum, value, i) => sum + (i - meanX) * (value - meanY), 0) / denominator;
  const trendValue = (i: number) => Math.min(maximum, Math.max(0, meanY + slope * (i - meanX)));
  const firstColor = kind === 'revenue' ? '#21b579' : kind === 'orders' ? '#35b9dd' : '#5d8ef9';
  const secondColor = kind === 'orders' ? '#ef6a72' : '#f5b544';
  const names = kind === 'orders' ? ['Orders', 'Unpaid / partially paid'] : ['Current period', 'Previous period'];
  const current = selected === null ? null : points[selected];
  const valueText = (value: number) => isMoney ? currency(value) : `${value} orders`;
  const labelEvery = Math.ceil(points.length / 7);
  const title = kind === 'sales' ? 'Daily collected revenue comparison' : kind === 'revenue' ? 'Cumulative collected revenue' : 'Daily order and unpaid order counts';

  return <div className="dashboard-chart" ref={container}>
    <div className="dashboard-chart-topline"><div className="dashboard-chart-unit">{isMoney ? 'Collected revenue · LKR' : 'Number of orders'}</div>{kind !== 'orders' && <span className="dashboard-line-key"><i />{kind === 'sales' ? 'Daily collections' : 'Revenue trend'}</span>}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <title>{title}</title>
      <desc>Use the date buttons below to read exact values. {rawMax === 0 ? 'No activity recorded in this period.' : ''}</desc>
      <defs><clipPath id={`${id}-clip`}><rect x={LEFT} y={TOP - 4} width={PW} height={PH + 8} /></clipPath>{[firstColor, secondColor].map((color, i) => <linearGradient key={color} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".38" /><stop offset="100%" stopColor={color} stopOpacity=".025" /></linearGradient>)}</defs>
      {Array.from({ length: 5 }, (_, i) => {
        const value = maximum * i / 4;
        return <g key={i}><line x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} stroke="#edf0f5" strokeDasharray={i === 0 ? undefined : '3 4'} /><text x={LEFT - 10} y={y(value) + 4} textAnchor="end" className="dashboard-chart-axis">{compact(value)}</text></g>;
      })}
      {kind === 'sales' ? <>
        {points.map((p, i) => <g key={p.date}>
          <rect x={x(i) - step * .3} y={y(first[i])} width={step * .25} height={TOP + PH - y(first[i])} rx="2" fill={firstColor} />
          <rect x={x(i) + step * .05} y={y(second[i])} width={step * .25} height={TOP + PH - y(second[i])} rx="2" fill={secondColor} />
        </g>)}
        <path d={line(first)} fill="none" stroke="#ef6a72" strokeWidth="2" strokeLinejoin="round" />
      </> : <>
        <path d={area(second)} fill={`url(#${id}-1)`} />
        <path d={area(first)} fill={`url(#${id}-0)`} />
        <path d={seriesLine(second)} fill="none" stroke={secondColor} strokeWidth="2" strokeLinejoin="round" />
        <path d={seriesLine(first)} fill="none" stroke={firstColor} strokeWidth="2.5" strokeLinejoin="round" />
        {kind === 'revenue' && rawMax > 0 && <path d={`M${x(0)},${y(trendValue(0))} L${x(first.length - 1)},${y(trendValue(first.length - 1))}`} fill="none" stroke="#ef6a72" strokeWidth="2" clipPath={`url(#${id}-clip)`}><title>Linear trend fitted to current cumulative revenue; not a forecast</title></path>}
      </>}
      {rawMax > 0 && points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1 || selected === i) && <g key={`point-${p.date}`}>
        <circle cx={currentX(i)} cy={y(first[i])} r={selected === i ? 4.5 : 3} fill={kind === 'sales' ? '#ef6a72' : firstColor} stroke="#fff" strokeWidth="1.5" />
        {kind !== 'sales' && <circle cx={x(i)} cy={y(second[i])} r={selected === i ? 4 : 2.8} fill={secondColor} stroke="#fff" strokeWidth="1.5" />}
      </g>)}
      {selected !== null && <g><line x1={currentX(selected)} x2={currentX(selected)} y1={TOP} y2={TOP + PH} stroke="#a4afc4" strokeDasharray="4 4" /><circle cx={currentX(selected)} cy={y(first[selected])} r="4" fill={firstColor} stroke="#fff" strokeWidth="2" /></g>}
      {points.map((p, i) => <g key={p.date}>
        {i % labelEvery === 0 && <text x={x(i)} y={H - 10} textAnchor="middle" className="dashboard-chart-axis">{p.label}</text>}
        <rect x={LEFT + step * i} y={TOP} width={step} height={PH} fill="transparent" onPointerEnter={() => setSelected(i)} onPointerLeave={() => setSelected(null)} onClick={() => setSelected(i)}><title>{`${p.date}: ${names[0]} ${valueText(first[i])}; ${names[1]} ${valueText(second[i])}`}</title></rect>
      </g>)}
    </svg>
    {current && selected !== null && <div className="dashboard-chart-tooltip" style={{ left: `${Math.min(W - 125, Math.max(125, x(selected))) / W * 100}%` }}><b>{current.label}</b><span><i style={{ background: firstColor }} />{names[0]}<strong>{valueText(first[selected])}</strong></span><span><i style={{ background: secondColor }} />{names[1]}<strong>{valueText(second[selected])}</strong></span></div>}
    <div className="dashboard-chart-readout" aria-live="polite">
      {current && selected !== null ? <><b>{current.label}</b><span>{names[0]}: {valueText(first[selected])}</span><span>{names[1]}: {valueText(second[selected])}{kind !== 'orders' ? ` (${current.previousDate})` : ''}</span></> : <span>{rawMax === 0 ? 'No activity in the selected period' : 'Hover a date to explore · tap or use date details below'}</span>}
    </div>
    <div className="dashboard-chart-legend"><span><i style={{ background: firstColor }} />{names[0]}</span><span><i style={{ background: secondColor }} />{names[1]}</span>{kind !== 'orders' && <span><i className="legend-line" style={{ background: '#ef6a72' }} />{kind === 'sales' ? 'Daily collections' : 'Linear revenue trend'}</span>}</div>
    <details className="dashboard-chart-details"><summary>View date details</summary><div className="dashboard-chart-date-buttons">{points.map((p, i) => <button key={p.date} type="button" onFocus={() => setSelected(i)} onClick={() => setSelected(i)} aria-label={`${p.date}, ${names[0]} ${valueText(first[i])}, ${names[1]} ${valueText(second[i])}`}>{p.label}</button>)}</div></details>
  </div>;
}
