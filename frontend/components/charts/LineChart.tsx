type LinePoint = {
  label: string;
  value: number;
};

type LineChartProps = {
  title: string;
  points: LinePoint[];
  color?: string;
};

export function LineChart({ title, points, color = "var(--brand)" }: LineChartProps) {
  const width = 420;
  const height = 180;
  const padding = 18;
  const maxValue = Math.max(0.001, ...points.map((point) => point.value));
  const minValue = Math.min(...points.map((point) => point.value));
  const range = Math.max(0.001, maxValue - minValue);

  const mapX = (index: number) => {
    if (points.length === 1) {
      return width / 2;
    }
    return padding + (index / (points.length - 1)) * (width - padding * 2);
  };
  const mapY = (value: number) =>
    height - padding - ((value - minValue) / range) * (height - padding * 2);

  const polylinePoints = points
    .map((point, index) => `${mapX(index)},${mapY(point.value)}`)
    .join(" ");

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay-strong)] p-4 shadow-[0_12px_28px_rgba(8,24,38,0.12)]">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill="var(--surface-elevated)"
          rx="10"
        />
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <g key={point.label}>
            <circle cx={mapX(index)} cy={mapY(point.value)} r="4" fill={color} />
            <text
              x={mapX(index)}
              y={height - 2}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
