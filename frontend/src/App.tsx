import { Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/lib/theme-context";
import { RequireAuth } from "@/components/require-auth";
import Home from "@/pages/Home";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import SsoCallback from "@/pages/SsoCallback";
import OAuthConnect from "@/pages/OAuthConnect";
import DashboardLayout from "@/layouts/DashboardLayout";
import Dashboard from "@/pages/dashboard/Dashboard";
import Activity from "@/pages/dashboard/Activity";
import Memory from "@/pages/dashboard/Memory";
import MemoryGraph from "@/pages/dashboard/MemoryGraph";
import Export from "@/pages/dashboard/Export";
import Connections from "@/pages/dashboard/Connections";
import Admin from "@/pages/dashboard/Admin";
import Settings from "@/pages/dashboard/Settings";

const DESIGN_BRIEF_COMMENT = `<!--
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
-->`;

export default function App() {
  return (
    <ThemeProvider>
      <div aria-hidden style={{ display: "none" }} dangerouslySetInnerHTML={{ __html: DESIGN_BRIEF_COMMENT }} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/sso-callback" element={<SsoCallback />} />
        <Route path="/oauth-connect" element={<OAuthConnect />} />
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="activity" element={<Activity />} />
            <Route path="memory" element={<Memory />} />
            <Route path="memory-graph" element={<MemoryGraph />} />
            <Route path="export" element={<Export />} />
            <Route path="connections" element={<Connections />} />
            <Route path="admin" element={<Admin />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
