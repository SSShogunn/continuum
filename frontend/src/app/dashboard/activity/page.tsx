"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { relativeTime, stringToHue } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity as ActivityIcon, ChevronDown, Inbox } from "lucide-react";

interface ActivityRow {
  tool: string;
  status: string;
  duration_ms: number;
  timestamp: string;
  arguments: string | null;
  error: string | null;
}

function toolDot(tool: string) {
  const hue = stringToHue(tool);
  return { backgroundColor: `oklch(0.7 0.16 ${hue})` };
}

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (toolFilter !== "all") params.set("tool", toolFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    fetch(`/api/stats/activity?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setRows(data.activity ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [toolFilter, statusFilter]);

  const tools = useMemo(
    () => Array.from(new Set(rows.map((r) => r.tool))).sort(),
    [rows]
  );

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ActivityIcon className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Activity</h1>
            <p className="text-xs text-muted-foreground">Recent tool calls across all clients</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={toolFilter} onValueChange={(v) => setToolFilter(v ?? "all")}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tools</SelectItem>
              {tools.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ok">ok</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : error ? (
        <p className="text-destructive text-sm">Failed to load activity: {error}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-5" />
          </div>
          <p className="text-muted-foreground text-sm">No tool calls match this filter yet.</p>
        </div>
      ) : (
        <Card surface="chrome">
          <CardContent className="p-0">
            <AnimatePresence initial={false}>
              {rows.map((row, i) => {
                const isOpen = expanded === i;
                return (
                  <motion.div
                    key={`${row.timestamp}-${i}`}
                    layout
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="relative border-b last:border-b-0"
                  >
                    <span
                      className="absolute left-0 top-0 bottom-0 w-0.5"
                      style={toolDot(row.tool)}
                    />
                    <button
                      onClick={() => setExpanded(isOpen ? null : i)}
                      className="w-full text-left pl-4 pr-3 py-2.5 flex items-center gap-3 hover:bg-accent/50 transition-colors"
                    >
                      <span className="size-1.5 rounded-full shrink-0" style={toolDot(row.tool)} />
                      <span className="font-mono text-xs truncate flex-1 min-w-0">{row.tool}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                          row.status === "error"
                            ? "bg-chart-4/15 text-chart-4"
                            : "bg-chart-2/15 text-chart-2"
                        }`}
                      >
                        {row.status}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                        {row.duration_ms}ms
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                        {relativeTime(row.timestamp)}
                      </span>
                      <ChevronDown
                        className={`size-3.5 text-muted-foreground shrink-0 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="overflow-hidden"
                        >
                          <div className="pl-4 pr-3 pb-3 space-y-2">
                            {row.arguments && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                                  Arguments
                                </p>
                                <pre className="text-xs font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words">
                                  {row.arguments}
                                </pre>
                              </div>
                            )}
                            {row.error && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                                  Error
                                </p>
                                <pre className="text-xs font-mono bg-chart-4/10 text-chart-4 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words">
                                  {row.error}
                                </pre>
                              </div>
                            )}
                            {!row.arguments && !row.error && (
                              <p className="text-xs text-muted-foreground">No further details.</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        See the <Link href="/dashboard" className="underline underline-offset-2">Stats</Link> page for aggregate trends.
      </p>
    </div>
  );
}
