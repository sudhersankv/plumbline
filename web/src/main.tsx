import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./styles.css";
import Platform from "./pages/Platform";
import Workflows from "./pages/Workflows";
import Overview from "./pages/Overview";
import Review from "./pages/Review";
import Runs, { RunDetail } from "./pages/Runs";
import Benchmarks from "./pages/Benchmarks";
import Routing from "./pages/Routing";
import Datasets from "./pages/Datasets";

function Shell() {
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand"><span className="brand-mark" aria-hidden /><span className="brand-name">Plumbline</span></div>
        <div className="rail-group">
          <div className="rail-label">AI platform</div>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/workflows">Workflows</NavLink>
          <NavLink to="/gateway">Gateway &amp; routing</NavLink>
          <NavLink to="/evals">Evals</NavLink>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/datasets">Datasets</NavLink>
        </div>
        <div className="rail-group">
          <div className="rail-label">Apps · Compliance workspace</div>
          <NavLink to="/changes">Regulatory changes</NavLink>
          <NavLink to="/gaps/sunvale">Gap review · Sunvale</NavLink>
          <NavLink to="/gaps/bayline">Gap review · Bayline</NavLink>
          <NavLink to="/audit/sunvale">Audit review · Sunvale</NavLink>
        </div>
        <div className="rail-foot">
          Toy platform. Sunvale and Bayline are fictional health plans; DHCS APL 26-001 is a real regulation.
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Platform />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/gateway" element={<Routing />} />
          <Route path="/routing" element={<Navigate to="/gateway" replace />} />
          <Route path="/evals" element={<Benchmarks />} />
          <Route path="/benchmarks" element={<Navigate to="/evals" replace />} />
          <Route path="/changes" element={<Overview />} />
          <Route path="/gaps/:plan" element={<Review kind="gap" />} />
          <Route path="/audit/:plan" element={<Review kind="audit" />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/datasets" element={<Datasets />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><Shell /></BrowserRouter></StrictMode>,
);
