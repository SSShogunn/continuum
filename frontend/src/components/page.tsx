import type { ComponentType, ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type PageWidth = "wide" | "content" | "narrow";

const WIDTHS: Record<PageWidth, string> = {
  wide: "max-w-page",
  content: "max-w-page-content",
  narrow: "max-w-page-narrow",
};

const GUTTER = "px-4 sm:px-6 lg:px-8";

export function Page({
  title,
  description,
  icon: Icon,
  actions,
  width = "wide",
  fill = false,
  bleed = false,
  children,
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  width?: PageWidth;
  fill?: boolean;
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", fill ? "h-svh overflow-hidden" : "min-h-svh")}>
      <header className="sticky top-0 z-40 shrink-0 border-b bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/65">
        <div className={cn("flex w-full items-center gap-3 py-3", GUTTER)}>
          <SidebarTrigger className="-ml-1.5 shrink-0 text-muted-foreground hover:text-foreground" />
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base leading-tight font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="truncate text-xs leading-tight text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>

      <div
        className={cn(
          "w-full",
          bleed ? "" : cn("mx-auto", GUTTER, WIDTHS[width]),
          fill ? "flex min-h-0 flex-1 flex-col" : "pt-7 pb-16",
          fill && !bleed ? "py-4" : ""
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
