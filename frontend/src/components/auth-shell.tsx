import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ContinuumMark } from "@/components/continuum-mark";

export function AuthShell({
  tab,
  stamp,
  children,
}: {
  tab: string;
  stamp: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent 78px)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mb-0 flex justify-center"
        >
          <span className="rounded-t border border-b-0 border-border bg-foreground/[0.04] px-3.5 py-1.5 font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase">
            {tab}
          </span>
        </motion.div>

        <motion.div
          data-slot="card"
          data-surface="paper"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full min-w-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card px-7 py-8 text-card-foreground sm:px-9 sm:py-10 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_14px_30px_-14px_rgba(0,0,0,0.3)] dark:shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_24px_48px_-18px_rgba(0,0,0,0.65)] [&_*]:min-w-0 [&_*]:max-w-full"
        >
          <span
            aria-hidden
            className="absolute left-[0.7rem] top-[0.6rem] size-2 rounded-full bg-[#1a1c1f] shadow-[0_1px_1px_rgba(255,255,255,0.15)_inset]"
          />
          <span
            aria-hidden
            className="absolute right-[0.7rem] top-[0.6rem] size-2 rounded-full bg-[#1a1c1f] shadow-[0_1px_1px_rgba(255,255,255,0.15)_inset]"
          />

          <span
            aria-hidden
            className="absolute right-5 top-5 flex size-14 -rotate-[9deg] items-center justify-center rounded-full border-[1.5px] border-primary text-center font-mono text-[0.55rem] leading-tight font-bold tracking-wider text-primary opacity-80 mix-blend-multiply"
          >
            {stamp}
          </span>

          <Link to="/" className="mb-6 flex items-center gap-2 font-heading text-[1.05rem] font-semibold tracking-tight text-card-foreground">
            <ContinuumMark className="size-4 shrink-0 text-primary" />
            Continuum
          </Link>

          {children}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="mt-6 text-center font-mono text-xs text-muted-foreground"
        >
          <Link to="/" className="transition-colors hover:text-foreground">
            ← Back to home
          </Link>
        </motion.p>
      </div>
    </main>
  );
}
