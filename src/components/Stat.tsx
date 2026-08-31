import type { Stat as StatValue } from "@/lib/irr";

/**
 * Renders a coefficient. A null value is a real result -- usually a code with
 * no variance, where kappa is 0/0 -- so it shows why rather than printing a
 * misleading number.
 */
export function StatCell({ stat, digits = 3 }: { stat: StatValue; digits?: number }) {
  if (stat.value === null) {
    return (
      <span className="faint text-[12px]" title={stat.reason}>
        undefined
      </span>
    );
  }
  return <span className="num">{stat.value.toFixed(digits)}</span>;
}

/** Landis & Koch bands, shown as a hint rather than a verdict. */
export function agreementLabel(value: number | null): string {
  if (value === null) return "";
  if (value < 0) return "worse than chance";
  if (value < 0.2) return "slight";
  if (value < 0.4) return "fair";
  if (value < 0.6) return "moderate";
  if (value < 0.8) return "substantial";
  return "almost perfect";
}

export function Metric({
  label,
  stat,
  hint,
}: {
  label: string;
  stat: StatValue;
  hint?: string;
}) {
  return (
    <div className="panel p-3">
      <div className="label mb-1">{label}</div>
      <div className="text-[22px] font-semibold num leading-none">
        {stat.value === null ? (
          <span className="faint text-[14px] font-normal">undefined</span>
        ) : (
          stat.value.toFixed(3)
        )}
      </div>
      <div className="faint text-[11px] mt-1">
        {stat.value === null ? stat.reason : (hint ?? agreementLabel(stat.value))}
      </div>
    </div>
  );
}
