type BarChartItem = {
  label: string;
  value: number;
  color?: string;
};

type BarChartProps = {
  title: string;
  items: BarChartItem[];
};

export function BarChart({ title, items }: BarChartProps) {
  const maxValue = Math.max(0.001, ...items.map((item) => item.value));

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay-strong)] p-4 shadow-[0_12px_28px_rgba(8,24,38,0.12)]">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h3>
      <div className="space-y-2.5">
        {items.map((item) => {
          const width = Math.max(4, (item.value / maxValue) * 100);
          return (
            <div key={item.label} className="space-y-1.5">
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>{item.label}</span>
                <span>{item.value.toFixed(3)}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[var(--surface-elevated)]">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${width}%`,
                    background: item.color ?? "var(--brand)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
