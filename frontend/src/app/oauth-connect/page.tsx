"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function OAuthConnectPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    }
  }, [isLoaded, isSignedIn, router]);

  async function allow() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          state: state || null,
          code_challenge: codeChallenge || null,
          code_challenge_method: codeChallengeMethod || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Authorization failed");
        return;
      }
      window.location.href = data.redirect_url;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Connect to Continuum</h1>
          <p className="text-gray-400 text-sm">
            An MCP client is requesting access to your Continuum memory.
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg px-4 py-3 text-sm space-y-1">
          <p>
            <span className="text-gray-500">Signed in as </span>
            <span className="text-gray-200">{user?.primaryEmailAddress?.emailAddress}</span>
          </p>
          <p>
            <span className="text-gray-500">Redirect to </span>
            <span className="font-mono text-xs text-gray-400 break-all">{redirectUri}</span>
          </p>
        </div>

        <div className="text-sm text-gray-400">
          <p className="mb-2">This will allow the client to:</p>
          <ul className="list-disc list-inside space-y-1 text-gray-300">
            <li>Read and write your memory entries</li>
            <li>Use Continuum tools on your behalf</li>
          </ul>
        </div>

        {error && <p className="text-red-400 text-xs font-mono">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={allow}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-white text-gray-950 font-medium text-sm hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading ? "Authorizing…" : "Allow access"}
          </button>
          <button
            onClick={() => window.close()}
            className="flex-1 py-2.5 rounded-lg border border-gray-700 text-sm hover:border-gray-500 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
