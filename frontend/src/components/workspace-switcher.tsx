"use client";

import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";

export function WorkspaceSwitcher() {
  const { workspace, workspaces, setWorkspace, addWorkspace } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  function submitNew() {
    const ws = draft.trim();
    if (!ws) return;
    addWorkspace(ws);
    setDraft("");
    setCreating(false);
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setCreating(false)}>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md border bg-secondary/40 px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Workspace</span>
        <span>{workspace}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws} onClick={() => setWorkspace(ws)} className="justify-between">
            {ws}
            {ws === workspace && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="flex items-center gap-1.5 px-1.5 py-1">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="workspace name…"
              className="h-7 text-xs"
            />
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setCreating(true)
            }}
            className="gap-1.5 text-muted-foreground"
          >
            <Plus className="size-3.5" />
            New workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
