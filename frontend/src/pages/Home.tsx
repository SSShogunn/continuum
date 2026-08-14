import { useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@clerk/react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { ContinuumMark } from "@/components/continuum-mark";
import styles from "./Home.module.css";

const STEPS = [
  { number: "REC-01", title: "Connect", body: "Point any MCP-compatible client at your Continuum endpoint." },
  { number: "REC-02", title: "Consent", body: "Authorize via OAuth 2.0 — you control exactly what gets shared." },
  { number: "REC-03", title: "Remember", body: "Facts, preferences, and context are extracted and filed automatically." },
  { number: "REC-04", title: "Recall", body: "Every future session picks up right where the last one left off." },
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

function GithubMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function StampBadge({ state }: { state: "verified" | "superseded" }) {
  const stateClass = state === "verified" ? styles.demoStampVerified : styles.demoStampSuperseded;
  return (
    <span className={`${styles.demoStampBadge} ${stateClass}`}>
      {state === "verified" ? "VERIFIED" : "SUPERSEDED"}
    </span>
  );
}

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const [saveCount, setSaveCount] = useState(0);
  const factValue = saveCount % 2 === 0 ? "editor: vim" : "editor: vim, tab width 2";

  return (
    <main className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.drawerTabs}>
          <span className={styles.drawerTab}>CLAUDE.AI</span>
          <span className={styles.drawerTab}>CLAUDE CODE</span>
          <span className={styles.drawerTab}>MCP CLIENTS</span>
        </div>

        <div className={styles.drawerWrap}>
          <div className={styles.drawerCard}>
            <span className={styles.stampMark}>
              FILED
              <br />
              CTM
            </span>
            <div className={styles.wordmark}>Continuum</div>
            <h1 className={styles.headline}>
              Your AI forgets everything.
              <br />
              Yours won&apos;t.
            </h1>
            <p className={styles.sub}>
              One memory, every MCP client. Filed as atomic, cross-referenced facts —
              never a duplicated blob.
            </p>
            {isLoaded && (
              <div className={styles.ctaRow}>
                {isSignedIn ? (
                  <Link to="/dashboard" className={styles.ctaPrimary}>
                    Go to dashboard
                    <ArrowRight size={15} />
                  </Link>
                ) : (
                  <>
                    <Link to="/sign-up" className={styles.ctaPrimary}>
                      Get started
                      <ArrowRight size={15} />
                    </Link>
                    <Link to="/sign-in" className={styles.ctaSecondary}>
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Mechanism */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Filed, not forgotten</h2>
        <div className={styles.mechanismGrid}>
          {STEPS.map((step) => (
            <div key={step.number} className={styles.mechanismCard}>
              <span className={styles.callNumber}>{step.number}</span>
              <h3 className={styles.mechanismTitle}>{step.title}</h3>
              <p className={styles.mechanismBody}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Supersede demo */}
      <section className={`${styles.section} ${styles.demoSection}`}>
        <h2 className={styles.sectionHeading}>Superseded, never duplicated</h2>
        <div className={styles.demoLayout}>
          <div className={styles.demoCopy}>
            <p>
              Re-saving a memory doesn&apos;t add a second, half-contradicting entry. The
              prior fact is stamped superseded — kept, timestamped, never deleted — while
              search only ever surfaces the current one.
            </p>
            <button type="button" className={styles.demoButton} onClick={() => setSaveCount((n) => n + 1)}>
              <RotateCcw size={14} />
              Re-save this memory
            </button>
          </div>
          <div className={styles.demoStack}>
            <div key={saveCount} className={styles.demoCard}>
              <span className={styles.demoFactLabel}>fact · REC-{String(saveCount + 12).padStart(2, "0")}</span>
              <span className={styles.demoFactValue}>{factValue}</span>
              <StampBadge state="verified" />
            </div>
            {saveCount > 0 && (
              <div
                key={`prev-${saveCount}`}
                className={styles.demoCard}
                style={{ transform: "translate(10px, 14px) rotate(-2deg)", zIndex: -1, opacity: 0.9 }}
              >
                <span className={styles.demoFactLabel}>fact · REC-{String(saveCount + 11).padStart(2, "0")}</span>
                <span className={styles.demoFactValue}>editor: vim</span>
                <StampBadge state="superseded" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Tools */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Every tool, filed by drawer</h2>
        <div className={styles.toolsGrid}>
          {TOOL_GROUPS.map((group) => (
            <div key={group.category} className={styles.drawerGroup}>
              <div className={styles.drawerLabel}>{group.category}</div>
              <div className={styles.toolList}>
                {group.tools.map((tool) => (
                  <div key={tool.name} className={styles.toolRow}>
                    <div className={styles.toolName}>{tool.name}</div>
                    <div className={styles.toolDesc}>{tool.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.finalCta}>
          <h2 className={styles.finalCtaHeading}>Connect once. Remembered everywhere.</h2>
          {isLoaded && !isSignedIn && (
            <div className={styles.ctaRow} style={{ marginTop: "1.75rem" }}>
              <Link to="/sign-up" className={styles.ctaPrimary}>
                Get started
                <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerMark}>
            <ContinuumMark className="size-3.5 shrink-0" />
            Continuum
          </span>
          <a
            href="https://github.com/SSShogunn/continuum"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubLink}
          >
            <GithubMark />
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
