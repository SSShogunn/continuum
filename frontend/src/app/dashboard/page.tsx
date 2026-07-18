"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

interface MemoryEntry {
  name: string;
  type: string;
  description: string;
  updated_at: string;
}

interface TokenMeta {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export default function DashboardPage() {
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/memory").then((r) => r.json()),
      fetch("/api/tokens").then((r) => r.json()),
    ]).then(([mem, tok]) => {
      setMemory(mem.entries ?? []);
      setTokens(tok);
      setLoading(false);
    });
  }, []);

  async function mintToken() {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "default" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMintError(`Error ${res.status}: ${data.detail ?? JSON.stringify(data)}`);
        return;
      }
      setNewToken(data.token);
      setTokens((prev) =>
        ([{ id: data.id, label: data.label, createdAt: data.createdAt, revokedAt: null, lastUsedAt: null }] as TokenMeta[]).concat(
          prev.map((t) => ({ ...t, revokedAt: t.revokedAt ?? new Date().toISOString() }))
        )
      );
    } catch (e) {
      setMintError(String(e));
    } finally {
      setMinting(false);
    }
  }

  async function copy() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeToken = tokens.find((t) => !t.revokedAt);

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg">Continuum</span>
        <UserButton />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-12">
        {/* MCP Token */}
        <section>
          <h2 className="text-xl font-semibold mb-4">MCP Token</h2>
          {newToken ? (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 space-y-3">
              <p className="text-yellow-300 text-sm font-medium">
                Copy this token now — it will not be shown again.
              </p>
              <code className="block text-xs break-all text-gray-200 bg-gray-900 rounded p-3 font-mono">
                {newToken}
              </code>
              <button
                onClick={copy}
                className="px-4 py-2 rounded bg-yellow-600 hover:bg-yellow-500 text-sm font-medium transition-colors"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              {activeToken ? (
                <p className="text-sm text-gray-400">
                  Active token: <span className="text-gray-200">{activeToken.label}</span>{" "}
                  — created {new Date(activeToken.createdAt).toLocaleDateString()}
                </p>
              ) : (
                <p className="text-sm text-gray-400">No active token. Generate one to use Continuum with MCP clients.</p>
              )}
              <button
                onClick={mintToken}
                disabled={minting}
                className="px-4 py-2 rounded bg-white text-gray-950 text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {minting ? "Generating…" : activeToken ? "Rotate token" : "Generate token"}
              </button>
              {mintError && (
                <p className="text-red-400 text-xs mt-2 font-mono">{mintError}</p>
              )}
            </div>
          )}
        </section>

        {/* Memory */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Memory</h2>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : memory.length === 0 ? (
            <p className="text-gray-500 text-sm">No memory entries yet. Use your MCP token with an AI client to create some.</p>
          ) : (
            <ul className="space-y-2">
              {memory.map((e) => (
                <li key={e.name} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{e.name}</span>
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{e.type}</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{e.description}</p>
                  <p className="text-gray-600 text-xs mt-1">Updated {new Date(e.updated_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
