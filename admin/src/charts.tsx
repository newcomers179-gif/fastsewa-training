/**
 * One small chart: a daily count as a line with a faint area wash. Hand-drawn SVG (no chart library) so the
 * console stays light and its strict Content-Security-Policy stays strict.
 *
 * Marks follow the console's chart spec: 2px line, 10% area, an 8px+ end dot with a 2px surface ring,
 * hairline recessive grid, text in text colours (never the data colour), a crosshair + tooltip that also
 * work from the keyboard, and the full numbers available as a table next to it.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDay, formatNumber } from "./format";

export interface Point {
  day: string;
  value: number;
}

const W = 360;
const H = 150;
const M = { top: 12, right: 14, bottom: 24, left: 34 };

/** 7 → 8, 23 → 25, 120 → 125: a tidy ceiling for the y axis. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));

export function TrendChart({ points, noun, color = "#2b6c99" }: { points: Point[]; noun: { one: string; many: string }; color?: string }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const total = points.reduce((sum, p) => sum + p.value, 0);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length > 0 ? `${line} L${x(points.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : "";
  const last = points.length - 1;
  const ticks = [0, max / 2, max];
  const shown = active ?? (last >= 0 ? last : null);

  const indexFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return null;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (px - M.left) / innerW;
    return Math.max(0, Math.min(last, Math.round(ratio * last)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const current = active ?? last;
    if (event.key === "ArrowLeft") setActive(Math.max(0, current - 1));
    else if (event.key === "ArrowRight") setActive(Math.min(last, current + 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  const hovered = active !== null ? points[active] : null;
  const tipLeft = hovered ? Math.max(14, Math.min(86, (x(active!) / W) * 100)) : 0;

  return (
    <figure className="trend">
      <figcaption id={titleId}>
        <span className="trend-total">{formatNumber(total)}</span>
        <span className="muted"> {total === 1 ? noun.one : noun.many}</span>
      </figcaption>
      <div
        className="trend-plot"
        ref={box}
        tabIndex={0}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-hint`}
        onPointerMove={(e) => setActive(indexFromPointer(e))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" focusable="false">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text x={M.left - 6} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {points.length > 0 ? (
            <>
              <text x={M.left} y={H - 6} textAnchor="start">
                {formatDay(points[0].day)}
              </text>
              <text x={W - M.right} y={H - 6} textAnchor="end">
                {formatDay(points[last].day)}
              </text>
              <path d={area} fill={color} fillOpacity="0.1" />
              <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {hovered ? <line className="crosshair" x1={x(active!)} x2={x(active!)} y1={M.top} y2={M.top + innerH} /> : null}
              {shown !== null ? (
                <circle cx={x(shown)} cy={y(points[shown].value)} r="4.5" fill={color} stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              ) : null}
            </>
          ) : null}
        </svg>
        {hovered ? (
          <div className="tooltip" style={{ left: `${tipLeft}%` }} role="status">
            <span className="tooltip-value">
              <span className="tooltip-key" style={{ background: color }} />
              {formatNumber(hovered.value)}
            </span>
            <span className="muted"> {hovered.value === 1 ? noun.one : noun.many} · {formatDay(hovered.day)}</span>
          </div>
        ) : null}
      </div>
      <span className="sr-only" id={`${titleId}-hint`}>
        Use the left and right arrow keys to read each day.
      </span>
    </figure>
  );
}
