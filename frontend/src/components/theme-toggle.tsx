"use client";

import { useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme-context";

const OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
];

function subscribeNever() {
  return () => {};
}

// True once hydrated on the client, false during SSR/the first client render —
// avoids a theme-dependent icon mismatching between server and client markup.
function useHasMounted() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useHasMounted();

  const ActiveIcon = !mounted
    ? Sun
    : OPTIONS.find((o) => o.value === theme)?.icon ?? (resolvedTheme === "dark" ? Moon : Sun);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center justify-center rounded-md border bg-secondary/40 size-8 hover:bg-secondary transition-colors">
        <ActiveIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)} className="justify-between">
            <span className="flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {label}
            </span>
            {theme === value && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
