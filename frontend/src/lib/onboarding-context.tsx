import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useApiClient } from "@/lib/api-client";

interface Connection {
  client_id: string;
}

interface ManualToken {
  revokedAt: string | null;
}

interface MemoryStats {
  total_entries: number;
}

interface OnboardingContextValue {
  isNewUser: boolean;
  loading: boolean;
  refresh: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const [isNewUser, setIsNewUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      api.get<{ connections: Connection[]; manual_tokens: ManualToken[] }>("/api/connections"),
      api.get<MemoryStats>("/api/memory/stats"),
    ])
      .then(([connectionsData, memoryStats]) => {
        if (cancelled) return;
        const hasConnected =
          (connectionsData.connections?.length ?? 0) > 0 ||
          (connectionsData.manual_tokens ?? []).some((t) => !t.revokedAt);
        const hasData = (memoryStats.total_entries ?? 0) > 0;
        setIsNewUser(!hasConnected && !hasData);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, tick]);

  return (
    <OnboardingContext.Provider value={{ isNewUser, loading, refresh }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within an OnboardingProvider");
  return ctx;
}
