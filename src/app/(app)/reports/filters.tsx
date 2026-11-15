"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import type { Range } from "@/lib/reports/range";

const PRESETS = [
  { v: "week", l: "هذا الأسبوع" },
  { v: "month", l: "هذا الشهر" },
  { v: "30", l: "آخر 30 يومًا" },
  { v: "90", l: "آخر 90 يومًا" },
  { v: "custom", l: "فترة مخصصة" },
];

export function ReportFilters({ classrooms, classroomId, range }: { classrooms: { id: string; name: string }[]; classroomId: string; range: Range }) {
  const router = useRouter();
  const [preset, setPreset] = useState(range.preset);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function go(next: { classroom?: string; preset?: string; from?: string; to?: string }) {
    const p = new URLSearchParams({ classroom: next.classroom ?? classroomId, preset: next.preset ?? preset });
    if ((next.preset ?? preset) === "custom") {
      p.set("from", next.from ?? from);
      p.set("to", next.to ?? to);
    }
    router.push(`/reports?${p}`);
  }

  return (
    <Card className="no-print grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="الفصل" htmlFor="r-class">
        <Select id="r-class" value={classroomId} onChange={(e) => go({ classroom: e.target.value })}>
          {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="الفترة" htmlFor="r-preset">
        <Select id="r-preset" value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== "custom") go({ preset: e.target.value }); }}>
          {PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </Select>
      </Field>
      {preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2 sm:col-span-3">
          <Field label="من" htmlFor="r-from"><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" /></Field>
          <Field label="إلى" htmlFor="r-to"><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></Field>
          <Button type="button" onClick={() => go({})}>عرض</Button>
        </div>
      ) : (
        <p className="text-xs text-muted sm:pb-3 ltr-nums">{range.from} → {range.to}</p>
      )}
    </Card>
  );
}

export function PrintButton() {
  return <Button variant="secondary" onClick={() => window.print()}>🖨️ طباعة / PDF</Button>;
}
