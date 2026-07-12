"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight mb-4">Continuum</h1>
      <p className="text-gray-400 text-lg max-w-md mb-10">
        Persistent, semantic memory for your AI tools. Connect once, remember everything.
      </p>
      {isLoaded && (
        <div className="flex gap-4">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="px-6 py-3 rounded-lg bg-white text-gray-950 font-medium hover:bg-gray-200 transition-colors"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-up"
                className="px-6 py-3 rounded-lg bg-white text-gray-950 font-medium hover:bg-gray-200 transition-colors"
              >
                Get started
              </Link>
              <Link
                href="/sign-in"
                className="px-6 py-3 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      )}
    </main>
  );
}
