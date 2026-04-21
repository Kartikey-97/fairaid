"use client";

type LambdaSliderProps = {
  values: number[];
  current: number;
  onChange: (next: number) => void;
};

export function LambdaSlider({ values, current, onChange }: LambdaSliderProps) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  return (
    <div className="w-full space-y-4">
      <div className="relative pt-2">
        <input
          type="range"
          min={min}
          max={max}
          step={0.25}
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-2.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-2 focus:ring-offset-[var(--surface)] transition-all accent-[var(--brand)] hover:accent-brightness-110"
        />
      </div>
      <div className="flex justify-between text-sm font-medium text-[var(--text-muted)]">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={`transition-all duration-200 hover:text-[var(--text-strong)] ${current === value ? "text-[var(--brand)] font-bold scale-110" : ""}`}
          >
            {value.toFixed(2)}
          </button>
        ))}
      </div>
    </div>
  );
}
