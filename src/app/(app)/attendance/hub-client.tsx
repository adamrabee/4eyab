"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";

export function DatePicker({ value, max, base = "/attendance" }: { value: string; max: string; base?: string }) {
  const router = useRouter();
  return (
    <Input
      type="date"
      aria-label="التاريخ"
      value={value}
      max={max}
      dir="ltr"
      className="h-10 flex-1"
      onChange={(e) => e.target.value && router.push(`${base}?date=${e.target.value}`)}
    />
  );
}

export function OffSchedulePicker({ classrooms, date }: { classrooms: { id: string; name: string }[]; date: string }) {
  const router = useRouter();
  const [classroom, setClassroom] = useState(classrooms[0]?.id ?? "");
  const [period, setPeriod] = useState(1);
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-sm font-medium text-muted">تسجيل حضور لحصة غير موجودة في الجدول (انتظار، تعويض…)</summary>
      <Card className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <Field label="الفصل" htmlFor="os-class">
          <Select id="os-class" value={classroom} onChange={(e) => setClassroom(e.target.value)}>
            {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="الحصة" htmlFor="os-period">
          <Select id="os-period" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Button type="button" onClick={() => router.push(`/attendance/${classroom}?date=${date}&period=${period}`)}>فتح</Button>
      </Card>
    </details>
  );
}
