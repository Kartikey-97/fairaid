type TimelineItem = {
  id: string;
  label: string;
  start: string;
  end: string;
  lane?: string;
  color?: string;
};

type TimelineProps = {
  title: string;
  items: TimelineItem[];
};

function parseToMinutes(time: string): number {
  if (!time) {
    return 0;
  }
  // Accept ISO timestamps and plain HH:MM values.
  if (time.includes("T")) {
    const date = new Date(time);
    if (!Number.isNaN(date.getTime())) {
      return date.getHours() * 60 + date.getMinutes();
    }
  }
  if (!time || !time.includes(":")) {
    return 0;
  }
  const [h, m] = time.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

export function Timeline({ title, items }: TimelineProps) {
  const minStart = Math.min(...items.map((item) => parseToMinutes(item.start)), 480);
  const maxEnd = Math.max(...items.map((item) => parseToMinutes(item.end)), 1200);
  const range = Math.max(60, maxEnd - minStart);

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => {
          const start = parseToMinutes(item.start);
          const end = parseToMinutes(item.end);
          const left = ((start - minStart) / range) * 100;
          const width = Math.max(4, ((end - start) / range) * 100);
          return (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>{item.label}</span>
                <span>
                  {item.start} - {item.end}
                </span>
              </div>
              <div className="relative h-3 w-full rounded-full bg-[var(--surface-elevated)]">
                <div
                  className="absolute top-0 h-3 rounded-full"
                  style={{
                    left: `${left}%`,
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
