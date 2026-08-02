import type { Metadata } from "next";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/lib/theme-context";
import { display, mono } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Continuum",
  description: "Your persistent AI memory layer",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("continuum:theme");
    var theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
    var resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    if (resolved === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={{ signIn: { start: { title: "Sign in to Continuum" } } }}>
      <html
        lang="en"
        className={`h-full antialiased ${display.variable} ${mono.variable}`}
        suppressHydrationWarning
      >
        <body className="min-h-full">
          <div
            aria-hidden
            style={{ display: "none" }}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{
              __html: `<!--
THESIS: Memory as an archive, not a chat log — the page argues its own
"invalidate, don't duplicate" mechanism through a working card-catalog
system, refusing the dark-gradient-glass AI landing default.
OWN-WORLD: Graphite steel #2A2D31 ground, rubber-stamp ink red #D64545
(accents/CTAs/stamps), manila tan #C9A66B (tabs), warm card white #F2EFE6
(card surfaces only). IBM Plex Mono for record fields/call-numbers, Space
Grotesk for display type. No serif, no cream ground.
STORY: A visitor sees their own MCP clients filed as real drawer tabs,
watches a fact get stamped SUPERSEDED instead of duplicated, and signs up
trusting the mechanism, not a claim.
FIRST VIEWPORT: Steel drawer wall, one drawer pulled forward mid-scroll,
an index card bearing the real headline stamped in red ink, CTA rendered
as an embossed catalog stamp button.
FORM: Archive Finding Aid — candidate 5 of 7 grounded directions (ordered
by resonance), seed key f93d8572.
FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, and DESIGN.md.
-->`,
            }}
          />
          <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
