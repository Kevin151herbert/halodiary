"use client";

import { TERM_OPTIONS } from "@/lib/contract";
import { field } from "./ui";

export function TermSelect({
  label,
  name,
  value,
  unit,
  onChange,
  options,
}: {
  label: string;
  name: keyof typeof TERM_OPTIONS;
  value: number;
  unit: (v: number) => string;
  onChange: (v: number) => void;
  options?: readonly number[];
}) {
  return (
    <label className="block text-xs font-bold text-slate">
      {label}
      <select name={`t_${name}`} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${field} mt-1 py-2.5 text-ink`}>
        {(options ?? TERM_OPTIONS[name]).map((o) => (
          <option key={o} value={o}>
            {unit(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
