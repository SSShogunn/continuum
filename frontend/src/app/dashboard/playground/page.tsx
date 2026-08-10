"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ParamType = "string" | "number" | "boolean" | "textarea" | "stringlist";

interface ParamDef {
  name: string;
  type: ParamType;
  required?: boolean;
  default?: string;
}

interface ToolDef {
  name: string;
  desc: string;
  params: ParamDef[];
}

const TOOLS: ToolDef[] = [
  {
    name: "search_web",
    desc: "Search the web via self-hosted SearXNG",
    params: [
      { name: "query", type: "string", required: true },
      { name: "count", type: "number", default: "10" },
    ],
  },
  {
    name: "fetch_page",
    desc: "Fetch a JS-rendered page as markdown",
    params: [
      { name: "url", type: "string", required: true },
      { name: "wait_for_selector", type: "string" },
      { name: "timeout_ms", type: "number", default: "15000" },
      { name: "readability", type: "boolean" },
    ],
  },
  {
    name: "fetch_pages",
    desc: "Fetch multiple pages concurrently",
    params: [
      { name: "urls", type: "stringlist", required: true },
      { name: "wait_for_selector", type: "string" },
      { name: "timeout_ms", type: "number", default: "15000" },
      { name: "readability", type: "boolean" },
    ],
  },
  {
    name: "check_url",
    desc: "Confirm a URL actually resolves",
    params: [{ name: "url", type: "string", required: true }],
  },
  {
    name: "verify_quote",
    desc: "Check a quote appears verbatim on a page",
    params: [
      { name: "url", type: "string", required: true },
      { name: "quote", type: "textarea", required: true },
      { name: "context_chars", type: "number", default: "200" },
    ],
  },
  {
    name: "memory_save",
    desc: "Save or update a memory entry",
    params: [
      { name: "name", type: "string", required: true },
      { name: "type", type: "string", required: true },
      { name: "description", type: "string", required: true },
      { name: "content", type: "textarea", required: true },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
  {
    name: "memory_search",
    desc: "Semantic search over saved memories",
    params: [
      { name: "query", type: "string", required: true },
      { name: "top_k", type: "number", default: "5" },
      { name: "type", type: "string" },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
  {
    name: "memory_fact_search",
    desc: "Search individual extracted facts",
    params: [
      { name: "query", type: "string", required: true },
      { name: "top_k", type: "number", default: "5" },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
  {
    name: "memory_graph_search",
    desc: "Find memories connected to a named entity",
    params: [
      { name: "entity", type: "string", required: true },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
  {
    name: "memory_list",
    desc: "List saved memory entries",
    params: [
      { name: "type", type: "string" },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
  {
    name: "memory_delete",
    desc: "Delete a memory entry",
    params: [
      { name: "name", type: "string", required: true },
      { name: "workspace", type: "string", default: "default" },
    ],
  },
];

interface RunResult {
  is_error: boolean;
  text: string;
  data: unknown;
  images: string[];
}

function defaultValues(tool: ToolDef): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of tool.params) {
    values[p.name] = p.default ?? "";
  }
  return values;
}

export default function PlaygroundPage() {
  const [selectedTool, setSelectedTool] = useState<ToolDef>(TOOLS[0]);
  const [values, setValues] = useState<Record<string, string>>(defaultValues(TOOLS[0]));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectTool(name: string | null) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return;
    setSelectedTool(tool);
    setValues(defaultValues(tool));
    setResult(null);
    setError(null);
  }

  function buildArguments(): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const p of selectedTool.params) {
      const raw = values[p.name] ?? "";
      if (p.type === "boolean") {
        args[p.name] = raw === "true";
        continue;
      }
      if (!raw.trim()) continue;
      if (p.type === "number") {
        args[p.name] = Number(raw);
      } else if (p.type === "stringlist") {
        args[p.name] = raw
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        args[p.name] = raw;
      }
    }
    return args;
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/playground/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: selectedTool.name, arguments: buildArguments() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`Error ${res.status}: ${data.detail ?? JSON.stringify(data)}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <h2 className="text-xl font-semibold">Tool playground</h2>

        <Card className="max-w-xl">
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tool</Label>
              <Select value={selectedTool.name} onValueChange={selectTool}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOOLS.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedTool.desc}</p>
            </div>

            {selectedTool.params.map((p) => (
              <div key={p.name} className="space-y-1.5">
                <Label>
                  {p.name}
                  {p.required && <span className="text-destructive"> *</span>}
                </Label>
                {p.type === "boolean" ? (
                  <Select
                    value={values[p.name] || "false"}
                    onValueChange={(v) => v && setValues((prev) => ({ ...prev, [p.name]: v }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">false</SelectItem>
                      <SelectItem value="true">true</SelectItem>
                    </SelectContent>
                  </Select>
                ) : p.type === "textarea" || p.type === "stringlist" ? (
                  <Textarea
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.type === "stringlist" ? "one per line, or comma-separated" : undefined}
                    rows={p.type === "stringlist" ? 3 : 4}
                  />
                ) : (
                  <Input
                    type={p.type === "number" ? "number" : "text"}
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}

            <Button onClick={run} disabled={running}>
              {running ? "Running…" : "Run"}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive">
            <CardContent>
              <p className="text-destructive text-sm font-mono whitespace-pre-wrap">{error}</p>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card className={result.is_error ? "border-destructive" : undefined}>
            <CardContent className="space-y-3">
              {result.is_error && <p className="text-destructive text-sm font-medium">Tool returned an error</p>}
              {result.text && (
                <pre className="text-sm whitespace-pre-wrap font-mono bg-muted rounded p-3 overflow-x-auto">
                  {result.text}
                </pre>
              )}
              {result.images?.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="tool result" className="rounded border max-w-full" />
              ))}
              {result.data != null && (
                <pre className="text-xs whitespace-pre-wrap font-mono bg-muted rounded p-3 overflow-x-auto">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        )}
    </main>
  );
}
