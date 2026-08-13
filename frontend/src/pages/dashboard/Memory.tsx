import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "@/lib/workspace-context";
import { relativeTime, stringToHue } from "@/lib/utils";
import { useApiClient } from "@/lib/api-client";
import { MemoryMarkdown } from "@/lib/markdown";
import { extractLinks, hasUnlinkedMention, linkFirstMention } from "@/lib/wikilink";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Command,
  Database,
  Download,
  Inbox,
  Link2,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";

type RecallTier = "always" | "relevance" | "manual";

interface MemoryEntry {
  name: string;
  type: string;
  recall?: RecallTier;
  description: string;
  content: string;
  created_at?: string;
  updated_at: string;
  archived_at?: string | null;
}

interface ReviewCandidate {
  name: string;
  type: string;
  recall: RecallTier;
  statements: string[];
}

interface SessionCandidate {
  id: number;
  session_id: string | null;
  name: string;
  type: string;
  recall: RecallTier;
  description: string;
  content: string;
  supersedes: string | null;
  created_at: string;
}

interface EditorState {
  mode: "create" | "edit";
  name: string;
  type: string;
  recall: RecallTier;
  description: string;
  content: string;
}

const RECALL_LABELS: Record<RecallTier, string> = {
  always: "Always-on",
  relevance: "On relevance",
  manual: "Manual only",
};

const RECALL_HINTS: Record<RecallTier, string> = {
  always: "Injected into every message, past the relevance gate.",
  relevance: "Surfaced only when a message is semantically close to it.",
  manual: "Never auto-injected — only returned by an explicit search.",
};

const COMMON_TYPES = ["user", "preference", "project", "reference", "person", "note"];

function tierOf(e: { recall?: RecallTier }): RecallTier {
  return e.recall ?? "relevance";
}

function typeDot(type: string) {
  const hue = stringToHue(type);
  return { backgroundColor: `oklch(0.7 0.16 ${hue})` };
}

function searchText(e: MemoryEntry) {
  return `${e.name}\n${e.description}\n${e.content}`.toLowerCase();
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
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dismissedReview, setDismissedReview] = useState(false);
  const [proposed, setProposed] = useState<SessionCandidate[]>([]);
  const [expandedProposal, setExpandedProposal] = useState<number | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [switcherIndex, setSwitcherIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  const loading = loadedWorkspace !== workspace;

  const refresh = useCallback(async () => {
    const data = await api.get<{ entries: MemoryEntry[]; workspaces: string[] }>(
      `/api/memory?workspace=${encodeURIComponent(workspace)}`
    );
    setMemory(data.entries ?? []);
    setWorkspaces(data.workspaces ?? ["default"]);
    setLoadedWorkspace(workspace);
    return data.entries ?? [];
  }, [api, workspace, setWorkspaces]);

  useEffect(() => {
    refresh().then(() => setSelectedName(null));
  }, [refresh]);

  useEffect(() => {
    setReviewOpen(false);
    setDismissedReview(false);
    api
      .get<{ candidates: ReviewCandidate[] }>(
        `/api/memory/review?workspace=${encodeURIComponent(workspace)}`
      )
      .then((data) => setCandidates(data.candidates ?? []))
      .catch(() => setCandidates([]));
  }, [workspace, api]);

  useEffect(() => {
    setExpandedProposal(null);
    api
      .get<{ candidates: SessionCandidate[] }>(
        `/api/memory/candidates?workspace=${encodeURIComponent(workspace)}`
      )
      .then((data) => setProposed(data.candidates ?? []))
      .catch(() => setProposed([]));
  }, [workspace, api]);

  async function resolveProposal(id: number, accept: boolean) {
    setResolving(id);
    try {
      await api.post("/api/memory/candidates/resolve", { id, accept, workspace });
      setProposed((prev) => prev.filter((c) => c.id !== id));
      if (accept) await refresh();
    } catch {
      // leave it in the queue if the call failed
    } finally {
      setResolving(null);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherQuery("");
        setSwitcherIndex(0);
        setSwitcherOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const byName = useMemo(() => new Map(memory.map((e) => [e.name, e])), [memory]);
  const selected = selectedName ? byName.get(selectedName) ?? null : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memory;
    return memory.filter((e) => searchText(e).includes(q));
  }, [memory, search]);

  const switcherResults = useMemo(() => {
    const q = switcherQuery.trim().toLowerCase();
    if (!q) return memory.slice(0, 12);
    return memory
      .filter((e) => searchText(e).includes(q))
      .sort((a, b) => {
        const an = a.name.toLowerCase().includes(q) ? 0 : 1;
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1;
        return an - bn;
      })
      .slice(0, 12);
  }, [memory, switcherQuery]);

  const outgoing = useMemo(() => (selected ? extractLinks(selected.content) : []), [selected]);

  const backlinks = useMemo(() => {
    if (!selected) return [];
    return memory.filter(
      (e) => e.name !== selected.name && extractLinks(e.content).includes(selected.name)
    );
  }, [memory, selected]);

  const unlinked = useMemo(() => {
    if (!selected) return [];
    const linked = new Set(backlinks.map((e) => e.name));
    return memory.filter(
      (e) =>
        e.name !== selected.name &&
        !linked.has(e.name) &&
        hasUnlinkedMention(`${e.description}\n${e.content}`, selected.name)
    );
  }, [memory, selected, backlinks]);

  function openEntry(name: string) {
    if (byName.has(name)) {
      setSelectedName(name);
      return;
    }
    setEditorError(null);
    setEditor({
      mode: "create",
      name,
      type: "note",
      recall: "relevance",
      description: "",
      content: "",
    });
  }

  function startCreate() {
    setEditorError(null);
    setEditor({ mode: "create", name: "", type: "note", recall: "relevance", description: "", content: "" });
  }

  function startEdit(entry: MemoryEntry) {
    setEditorError(null);
    setEditor({
      mode: "edit",
      name: entry.name,
      type: entry.type,
      recall: tierOf(entry),
      description: entry.description,
      content: entry.content,
    });
  }

  async function saveEntry(entry: {
    name: string;
    type: string;
    recall: RecallTier;
    description: string;
    content: string;
  }) {
    return api.post("/api/memory", { ...entry, workspace });
  }

  async function submitEditor() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name || !editor.content.trim()) {
      setEditorError("Name and content are both required.");
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      await saveEntry({ ...editor, name });
      await refresh();
      setEditor(null);
      setSelectedName(name);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function setRecall(name: string, recall: RecallTier) {
    const previous = memory;
    setMemory((prev) => prev.map((e) => (e.name === name ? { ...e, recall } : e)));
    if (recall === "always") setCandidates((prev) => prev.filter((c) => c.name !== name));
    try {
      await api.post("/api/memory/recall", { name, recall, workspace });
    } catch {
      setMemory(previous);
    }
  }

  async function linkMention(source: MemoryEntry, target: string) {
    const content = linkFirstMention(source.content, target);
    if (content === source.content) return;
    setMemory((prev) => prev.map((e) => (e.name === source.name ? { ...e, content } : e)));
    try {
      await saveEntry({
        name: source.name,
        type: source.type,
        recall: tierOf(source),
        description: source.description,
        content,
      });
    } catch {
      await refresh();
    }
  }

  function insertLink(name: string) {
    setEditor((prev) => {
      if (!prev) return prev;
      const el = contentRef.current;
      const at = el?.selectionStart ?? prev.content.length;
      const snippet = `[[${name}]]`;
      const content = prev.content.slice(0, at) + snippet + prev.content.slice(at);
      queueMicrotask(() => {
        el?.focus();
        el?.setSelectionRange(at + snippet.length, at + snippet.length);
      });
      return { ...prev, content };
    });
  }

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
      await refresh();
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
            <button
              onClick={() => setSwitcherOpen(true)}
              className="hidden md:flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <Search className="size-3.5" />
              Jump to…
              <kbd className="ml-1 flex items-center gap-0.5 rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
                <Command className="size-2.5" />K
              </kbd>
            </button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter…"
                className="h-8 w-40 pl-8"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload />
              {importing ? "Importing…" : "Import"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportMemory} disabled={memory.length === 0}>
              <Download />
              Export
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus />
              New
            </Button>
          </div>
        </div>

        {importMessage && (
          <div className="border-b bg-muted/40 px-6 py-2 text-xs text-muted-foreground shrink-0">
            {importMessage}
          </div>
        )}

        {proposed.length > 0 && (
          <div className="border-b bg-primary/5 px-6 py-2.5 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <p className="font-medium">
                {proposed.length} memor{proposed.length === 1 ? "y" : "ies"} proposed from recent
                sessions
              </p>
              <span className="text-muted-foreground">— nothing is saved until you approve it.</span>
            </div>

            <div className="mt-2 space-y-2">
              {proposed.map((c) => {
                const isOpen = expandedProposal === c.id;
                const isBusy = resolving === c.id;
                return (
                  <div key={c.id} className="rounded-md border bg-background px-3 py-2">
                    <div className="flex items-start gap-3">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setExpandedProposal(isOpen ? null : c.id)}
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-medium">{c.name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {c.type}
                          </Badge>
                          {c.recall === "always" && (
                            <Badge className="gap-1 text-[10px] px-1.5 py-0">
                              <Pin className="size-2.5" />
                              Always-on
                            </Badge>
                          )}
                          {byName.has(c.name) && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              updates existing
                            </Badge>
                          )}
                          {c.supersedes && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              supersedes {c.supersedes}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {c.description}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          disabled={isBusy}
                          onClick={() => resolveProposal(c.id, true)}
                        >
                          <Check />
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          disabled={isBusy}
                          onClick={() => resolveProposal(c.id, false)}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                    {isOpen && (
                      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-t pt-2 font-mono text-[11px] text-muted-foreground">
                        {c.content}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {candidates.length > 0 && !dismissedReview && (
          <div className="border-b bg-muted/40 px-6 py-2 shrink-0">
            <div className="flex items-center gap-3 text-xs">
              <TriangleAlert className="size-3.5 text-muted-foreground shrink-0" />
              <p className="text-muted-foreground min-w-0">
                {candidates.length} entr{candidates.length === 1 ? "y" : "ies"} read like standing
                rules but {candidates.length === 1 ? "isn't" : "aren't"} always-on — so{" "}
                {candidates.length === 1 ? "it" : "they"} only reach the model when a message
                happens to match.
              </p>
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setReviewOpen((v) => !v)}>
                  {reviewOpen ? "Hide" : "Review"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDismissedReview(true)}>
                  Dismiss
                </Button>
              </div>
            </div>

            {reviewOpen && (
              <div className="mt-2 space-y-2 pb-1">
                {candidates.map((c) => (
                  <div key={c.name} className="flex items-start gap-3 rounded-md border bg-background px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <button className="text-xs font-medium hover:underline" onClick={() => setSelectedName(c.name)}>
                        {c.name}
                      </button>
                      <ul className="mt-1 space-y-0.5">
                        {c.statements.map((s, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground line-clamp-1">
                            &ldquo;{s}&rdquo;
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs shrink-0"
                      onClick={() => setRecall(c.name, "always")}
                    >
                      <Pin />
                      Make always-on
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
                  No memory entries in &quot;{workspace}&quot; yet. Write one by hand, connect an AI client with
                  your MCP token, or{" "}
                  <Link to="/dashboard/settings" className="text-foreground underline underline-offset-2">
                    manage tokens in Settings
                  </Link>
                  .
                </p>
                <Button size="sm" className="mt-4" onClick={startCreate}>
                  <Plus />
                  New memory
                </Button>
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
                    const linkCount = extractLinks(e.content).length;
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
                        <span className="absolute left-0 top-0 bottom-0 w-0.5" style={typeDot(e.type)} />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{e.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {tierOf(e) !== "relevance" && (
                              <Badge
                                variant={tierOf(e) === "always" ? "default" : "outline"}
                                className="text-[10px] px-1.5 py-0 gap-1"
                              >
                                {tierOf(e) === "always" && <Pin className="size-2.5" />}
                                {RECALL_LABELS[tierOf(e)]}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                              <span className="size-1.5 rounded-full" style={typeDot(e.type)} />
                              {e.type}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1 line-clamp-1">{e.description}</p>
                        <p className="text-muted-foreground/60 text-[11px] mt-1 flex items-center gap-2">
                          {relativeTime(e.updated_at)}
                          {linkCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Link2 className="size-2.5" />
                              {linkCount}
                            </span>
                          )}
                        </p>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <p className="text-muted-foreground text-sm p-4">No entries match &quot;{search}&quot;.</p>
                )}
              </div>

              <div className={`${selectedName ? "flex" : "hidden lg:flex"} flex-1 min-w-0 overflow-y-auto`}>
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
                            {tierOf(selected) === "always" && (
                              <Badge className="gap-1">
                                <Pin className="size-3" />
                                Always-on
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground text-sm mt-1">{selected.description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => startEdit(selected)}>
                            <Pencil />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDelete(selected.name)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground mb-6 pb-6 border-b">
                        {selected.created_at && <span>Created {relativeTime(selected.created_at)}</span>}
                        <span>Updated {relativeTime(selected.updated_at)}</span>
                        <div className="flex items-center gap-2">
                          <span>Recall</span>
                          <Select
                            value={tierOf(selected)}
                            onValueChange={(v) => v && setRecall(selected.name, v as RecallTier)}
                          >
                            <SelectTrigger className="h-7 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(RECALL_LABELS) as RecallTier[]).map((tier) => (
                                <SelectItem key={tier} value={tier}>
                                  {RECALL_LABELS[tier]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="hidden sm:inline">{RECALL_HINTS[tierOf(selected)]}</span>
                        </div>
                      </div>

                      <div className="text-sm max-w-prose space-y-3">
                        <MemoryMarkdown
                          content={selected.content}
                          onWikilink={openEntry}
                          exists={(name) => byName.has(name)}
                        />
                      </div>

                      {outgoing.length > 0 && (
                        <div className="mt-8">
                          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            Links to
                          </h3>
                          <div className="flex flex-wrap gap-1.5">
                            {outgoing.map((name) => (
                              <button
                                key={name}
                                onClick={() => openEntry(name)}
                                className={`rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent ${
                                  byName.has(name) ? "" : "border-dashed text-muted-foreground"
                                }`}
                              >
                                {name}
                                {!byName.has(name) && " (new)"}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-8 border-t pt-6">
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          Linked mentions ({backlinks.length})
                        </h3>
                        {backlinks.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Nothing links here yet. Reference it as{" "}
                            <code className="rounded bg-muted px-1 py-0.5 font-mono">[[{selected.name}]]</code> from
                            another entry.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {backlinks.map((e) => (
                              <button
                                key={e.name}
                                onClick={() => setSelectedName(e.name)}
                                className="block w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                              >
                                <span className="flex items-center gap-1.5 text-xs font-medium">
                                  {e.name}
                                  <ArrowUpRight className="size-3 text-muted-foreground" />
                                </span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground line-clamp-2">
                                  {e.description}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {unlinked.length > 0 && (
                        <div className="mt-6 mb-6">
                          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            Unlinked mentions ({unlinked.length})
                          </h3>
                          <div className="space-y-2">
                            {unlinked.map((e) => (
                              <div
                                key={e.name}
                                className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2"
                              >
                                <button
                                  onClick={() => setSelectedName(e.name)}
                                  className="min-w-0 flex-1 text-left text-xs font-medium hover:underline"
                                >
                                  {e.name}
                                </button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 shrink-0 text-xs"
                                  onClick={() => linkMention(e, selected.name)}
                                >
                                  <Link2 />
                                  Link
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

      <Dialog open={switcherOpen} onOpenChange={setSwitcherOpen}>
        <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Jump to a memory</DialogTitle>
            <DialogDescription>Search across every entry in this workspace.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={switcherQuery}
            onChange={(e) => {
              setSwitcherQuery(e.target.value);
              setSwitcherIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSwitcherIndex((i) => Math.min(i + 1, switcherResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSwitcherIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                const hit = switcherResults[switcherIndex];
                if (hit) {
                  setSelectedName(hit.name);
                  setSwitcherOpen(false);
                }
              }
            }}
            placeholder="Search names, descriptions, content…"
            className="h-12 rounded-b-none border-0 border-b text-sm focus-visible:ring-0"
          />
          <div className="max-h-[50vh] overflow-y-auto p-1">
            {switcherResults.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No entries match &quot;{switcherQuery}&quot;.
              </p>
            ) : (
              switcherResults.map((e, i) => (
                <button
                  key={e.name}
                  onMouseEnter={() => setSwitcherIndex(i)}
                  onClick={() => {
                    setSelectedName(e.name);
                    setSwitcherOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left ${
                    i === switcherIndex ? "bg-accent" : ""
                  }`}
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={typeDot(e.type)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{e.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{e.description}</span>
                  </span>
                  {tierOf(e) === "always" && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? `Edit ${editor.name}` : "New memory"}</DialogTitle>
            <DialogDescription>
              Saved through the same path as an AI client's `memory_save` — re-embedded and re-indexed
              into the knowledge graph on write.
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor="memory-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="memory-name"
                    value={editor.name}
                    disabled={editor.mode === "edit"}
                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                    placeholder="project-continuum-status"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memory-type" className="text-xs">
                    Type
                  </Label>
                  <Input
                    id="memory-type"
                    list="memory-types"
                    value={editor.type}
                    onChange={(e) => setEditor({ ...editor, type: e.target.value })}
                    className="h-8 text-xs"
                  />
                  <datalist id="memory-types">
                    {[...new Set([...COMMON_TYPES, ...memory.map((e) => e.type)])].map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Recall</Label>
                  <Select
                    value={editor.recall}
                    onValueChange={(v) => v && setEditor({ ...editor, recall: v as RecallTier })}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RECALL_LABELS) as RecallTier[]).map((tier) => (
                        <SelectItem key={tier} value={tier}>
                          {RECALL_LABELS[tier]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="memory-description" className="text-xs">
                  Description
                </Label>
                <Input
                  id="memory-description"
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  placeholder="One line — this is what the hook shows on relevance hits."
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="memory-content" className="text-xs">
                  Content
                </Label>
                <Textarea
                  id="memory-content"
                  ref={contentRef}
                  value={editor.content}
                  onChange={(e) => setEditor({ ...editor, content: e.target.value })}
                  placeholder="Dense facts or bullets. Link other entries with [[their-name]]."
                  className="min-h-48 font-mono text-xs"
                />
                {memory.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-[11px] text-muted-foreground">Insert link:</span>
                    {memory
                      .filter((e) => e.name !== editor.name)
                      .slice(0, 6)
                      .map((e) => (
                        <button
                          key={e.name}
                          onClick={() => insertLink(e.name)}
                          className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                        >
                          {e.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">{RECALL_HINTS[editor.recall]}</p>
              {editorError && <p className="text-xs text-destructive">{editorError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitEditor} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
