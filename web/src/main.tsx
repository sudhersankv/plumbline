import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./styles.css";
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
          <div className="rail-label">Compliance workspace</div>
          <NavLink to="/" end>Regulatory changes</NavLink>
          <NavLink to="/gaps/sunvale">Gap review · Sunvale</NavLink>
          <NavLink to="/gaps/bayline">Gap review · Bayline</NavLink>
          <NavLink to="/audit/sunvale">Audit review · Sunvale</NavLink>
        </div>
        <div className="rail-group">
          <div className="rail-label">Platform</div>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/benchmarks">Benchmarks</NavLink>
          <NavLink to="/routing">Routing</NavLink>
          <NavLink to="/datasets">Datasets</NavLink>
        </div>
        <div className="rail-foot">
          Demo data. Sunvale and Bayline are fictional plans; DHCS APL 26-001 is real.
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/gaps/:plan" element={<Review kind="gap" />} />
          <Route path="/audit/:plan" element={<Review kind="audit" />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          <Route path="/routing" element={<Routing />} />
          <Route path="/datasets" element={<Datasets />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><Shell /></BrowserRouter></StrictMode>,
);
