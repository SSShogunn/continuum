import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "@/lib/workspace-context";
import { relativeTime, stringToHue } from "@/lib/utils";
import { useApiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Database, Download, Inbox, Search, Trash2, Upload } from "lucide-react";

interface MemoryEntry {
  name: string;
  type: string;
  description: string;
  content: string;
  created_at?: string;
  updated_at: string;
  archived_at?: string | null;
}

function typeDot(type: string) {
  const hue = stringToHue(type);
  return { backgroundColor: `oklch(0.7 0.16 ${hue})` };
}

export default function MemoryPage() {
  const api = useApiClient();
  const { workspace, setWorkspaces } = useWorkspace();
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loadedWorkspace, setLoadedWorkspace] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loading = loadedWorkspace !== workspace;

  useEffect(() => {
    api
      .get<{ entries: MemoryEntry[]; workspaces: string[] }>(
        `/api/memory?workspace=${encodeURIComponent(workspace)}`
      )
      .then((data) => {
        setMemory(data.entries ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setLoadedWorkspace(workspace);
        setSelectedName(null);
      });
  }, [workspace, setWorkspaces, api]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memory;
    return memory.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }, [memory, search]);

  const selected = memory.find((e) => e.name === selectedName) ?? null;

  async function confirmDelete() {
    if (!pendingDelete) return;
    const name = pendingDelete;
    setPendingDelete(null);
    try {
      await api.delete(`/api/memory/${encodeURIComponent(name)}?workspace=${encodeURIComponent(workspace)}`);
      setMemory((prev) => prev.filter((e) => e.name !== name));
      setSelectedName((prev) => (prev === name ? null : prev));
    } catch {
      // no-op — entry stays in the list if the delete failed
    }
  }

  function exportMemory() {
    const payload = {
      format: "continuum-memory-export",
      version: "1",
      exported_at: new Date().toISOString(),
      workspace,
      memories: memory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `continuum-memory-${workspace}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const parsed = JSON.parse(await file.text());
      const memories = Array.isArray(parsed) ? parsed : parsed.memories;
      if (!Array.isArray(memories)) {
        throw new Error("Expected a JSON array of memories, or an object with a 'memories' array.");
      }
      const data = await api.post<{ imported: number; skipped?: unknown[] }>(
        `/api/memory/import?workspace=${encodeURIComponent(workspace)}`,
        { memories }
      );
      const skippedCount = data.skipped?.length ?? 0;
      setImportMessage(
        `Imported ${data.imported} entr${data.imported === 1 ? "y" : "ies"}.` +
          (skippedCount ? ` Skipped ${skippedCount}.` : "")
      );
      const refreshed = await api.get<{ entries: MemoryEntry[] }>(
        `/api/memory?workspace=${encodeURIComponent(workspace)}`
      );
      setMemory(refreshed.entries ?? []);
    } catch (err) {
      setImportMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-3.75rem)]">
        <div className="flex items-center justify-between gap-4 border-b px-6 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Database className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Memory</h1>
              <p className="text-xs text-muted-foreground truncate">
                {loading ? "Loading…" : `${memory.length} entr${memory.length === 1 ? "y" : "ies"}`} in &quot;{workspace}&quot;
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter…"
                className="h-8 w-48 pl-8"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <Upload />
              {importing ? "Importing…" : "Import"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportMemory} disabled={memory.length === 0}>
              <Download />
              Export
            </Button>
          </div>
        </div>

        {importMessage && (
          <div className="border-b bg-muted/40 px-6 py-2 text-xs text-muted-foreground shrink-0">
            {importMessage}
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : memory.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6">
              <div className="text-center max-w-sm">
                <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Inbox className="size-5" />
                </div>
                <p className="text-muted-foreground text-sm">
                  No memory entries in &quot;{workspace}&quot; yet. Use your MCP token with an AI client to
                  create some, or{" "}
                  <Link to="/dashboard/settings" className="text-foreground underline underline-offset-2">
                    manage tokens in Settings
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`${
                  selectedName ? "hidden lg:block" : "block"
                } w-full lg:w-[360px] shrink-0 border-r overflow-y-auto`}
              >
                <AnimatePresence initial={false}>
                  {filtered.map((e) => {
                    const isActive = e.name === selectedName;
                    return (
                      <motion.button
                        key={e.name}
                        layout
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        onClick={() => setSelectedName(e.name)}
                        className={`relative w-full text-left pl-4 pr-3 py-3 border-b last:border-b-0 transition-colors ${
                          isActive ? "bg-accent" : "hover:bg-accent/50"
                        }`}
                      >
                        <span
                          className="absolute left-0 top-0 bottom-0 w-0.5"
                          style={typeDot(e.type)}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{e.name}</span>
                          <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 gap-1">
                            <span className="size-1.5 rounded-full" style={typeDot(e.type)} />
                            {e.type}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1 line-clamp-1">{e.description}</p>
                        <p className="text-muted-foreground/60 text-[11px] mt-1">{relativeTime(e.updated_at)}</p>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <p className="text-muted-foreground text-sm p-4">No entries match &quot;{search}&quot;.</p>
                )}
              </div>

              <div
                className={`${
                  selectedName ? "flex" : "hidden lg:flex"
                } flex-1 min-w-0 overflow-y-auto`}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {selected ? (
                    <motion.div
                      key={selected.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="p-6 max-w-3xl w-full"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mb-4 -ml-2 lg:hidden"
                        onClick={() => setSelectedName(null)}
                      >
                        <ArrowLeft />
                        Back
                      </Button>
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-semibold">{selected.name}</h2>
                            <Badge variant="secondary" className="gap-1">
                              <span className="size-1.5 rounded-full" style={typeDot(selected.type)} />
                              {selected.type}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-sm mt-1">{selected.description}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive shrink-0"
                          onClick={() => setPendingDelete(selected.name)}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-6 pb-6 border-b">
                        {selected.created_at && <span>Created {relativeTime(selected.created_at)}</span>}
                        <span>Updated {relativeTime(selected.updated_at)}</span>
                      </div>

                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Content
                      </h3>
                      <p className="text-sm whitespace-pre-wrap max-w-prose leading-relaxed">{selected.content}</p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="flex-1 flex items-center justify-center text-sm text-muted-foreground w-full"
                    >
                      Select an entry to view its details
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              Delete &quot;{pendingDelete}&quot;? This also removes its graph edges.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
