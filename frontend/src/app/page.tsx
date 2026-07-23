"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Connect", body: "Point any MCP-compatible client (Claude, etc.) at your Continuum endpoint." },
  { title: "Consent", body: "Authorize via OAuth 2.0 — you control exactly what gets shared." },
  { title: "Remember", body: "Facts, preferences, and context are extracted and stored automatically." },
  { title: "Recall", body: "Every future session picks up right where the last one left off." },
];

const TOOL_GROUPS: { category: string; tools: { name: string; desc: string }[] }[] = [
  {
    category: "Memory",
    tools: [
      { name: "memory_save", desc: "Save or update a persistent memory entry" },
      { name: "memory_search", desc: "Semantic search over saved memories" },
      { name: "memory_fact_search", desc: "Search individual extracted facts" },
      { name: "memory_graph_search", desc: "Find memories connected to a named entity" },
      { name: "memory_list", desc: "List saved memory entries" },
      { name: "memory_delete", desc: "Delete a memory entry" },
    ],
  },
  {
    category: "Browser & Web",
    tools: [
      { name: "fetch_page", desc: "Fetch a JS-rendered page as markdown" },
      { name: "fetch_pages", desc: "Batch fetch multiple pages" },
      { name: "screenshot_page", desc: "Screenshot a URL" },
      { name: "fetch_image", desc: "Download an image" },
      { name: "search_web", desc: "Search the web (self-hosted, no paid API)" },
    ],
  },
  {
    category: "Verification",
    tools: [
      { name: "check_url", desc: "Confirm a URL actually resolves" },
      { name: "verify_quote", desc: "Check a quote appears verbatim on a page" },
    ],
  },
];

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <main>
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-4">Continuum</h1>
        <p className="text-muted-foreground text-lg max-w-md mb-10">
          Persistent, semantic memory for your AI tools. Connect once, remember everything.
        </p>
        {isLoaded && (
          <div className="flex gap-4">
            {isSignedIn ? (
              <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "px-6 h-11")}>
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "px-6 h-11")}>
                  Get started
                </Link>
                <Link
                  href="/sign-in"
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-6 h-11")}
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-border">
        <h2 className="text-2xl font-semibold text-center mb-12">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
          {STEPS.map((step, i) => (
            <div key={step.title} className="text-center">
              <div className="w-8 h-8 mx-auto mb-3 rounded-full bg-muted border border-border flex items-center justify-center text-sm text-muted-foreground">
                {i + 1}
              </div>
              <h3 className="font-medium mb-1">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tools showcase */}
      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-border">
        <h2 className="text-2xl font-semibold text-center mb-12">Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {TOOL_GROUPS.map((group) => (
            <div key={group.category}>
              <h3 className="text-sm font-medium text-muted-foreground uppercase mb-3">{group.category}</h3>
              <div className="space-y-3">
                {group.tools.map((tool) => (
                  <Card key={tool.name} className="py-0">
                    <CardContent className="px-3 py-2">
                      <code className="text-sm font-mono">{tool.name}</code>
                      <p className="text-xs text-muted-foreground mt-0.5">{tool.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8 text-center text-sm">
        <Button
          variant="link"
          nativeButton={false}
          render={
            <a href="https://github.com/SSShogunn/continuum" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          }
        />
      </footer>
    </main>
  );
}
