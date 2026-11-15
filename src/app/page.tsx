import { ButtonLink, Card } from "@/components/ui";

const steps = [
  { t: "صوّر", d: "كشف الأسماء أو الجدول الأسبوعي — صورة أو PDF." },
  { t: "راجع", d: "يستخرج الذكاء الاصطناعي البيانات وتراجعها وتصحّحها قبل الحفظ." },
  { t: "حضّر", d: "تُنشأ فصولك وجدولك تلقائيًا، وتسجّل الحضور بلمسة." },
];

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium tracking-widest text-muted">HISSATI</p>
      <h1 className="mt-1 text-4xl font-bold text-primary sm:text-5xl">حصتي</h1>
      <p className="mt-4 max-w-xl text-lg leading-8">
        منصة ذكية لإدارة حضور الطلاب وغيابهم. لا حاجة لكتابة عشرات الأسماء أو إعادة إنشاء جدولك يدويًا.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink href="/signup">أنشئ حسابك مجانًا</ButtonLink>
        <ButtonLink href="/login" variant="secondary">
          تسجيل الدخول
        </ButtonLink>
      </div>
      <ol className="mt-10 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <Card key={s.t} className="p-4">
            <span className="text-sm font-bold text-primary">{i + 1}</span>
            <p className="mt-1 font-bold">{s.t}</p>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </Card>
        ))}
      </ol>
    </main>
  );
}
