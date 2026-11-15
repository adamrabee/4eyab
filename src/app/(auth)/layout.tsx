import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-center">
        <span className="text-3xl font-bold text-primary">حصتي</span>
        <span className="block text-xs tracking-widest text-muted">HISSATI</span>
      </Link>
      {children}
    </main>
  );
}
