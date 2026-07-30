"use client";

import type { CheckResult, Finding } from "@mcpcheck/core";
import { useState } from "react";

function band(letter: string): "ok" | "warn" | "bad" {
  if (letter === "A" || letter === "B") return "ok";
  if (letter === "C") return "warn";
  return "bad";
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setResult(data as CheckResult);
      }
    } catch {
      setError("Could not reach the checker.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <span className="stamp">
        Spec&nbsp;<b>2026-07-28</b>&nbsp;· readiness
      </span>

      <h1>Will your MCP server survive the rewrite?</h1>
      <p className="lede">
        The 2026-07-28 revision made MCP stateless, formalized OAuth 2.1, and
        dropped several capabilities — a refactor, not a version bump. Point the
        checker at a running endpoint to see what breaks.
      </p>

      <section className="console">
        <label htmlFor="url">MCP endpoint</label>
        <div className="row">
          <input
            id="url"
            type="text"
            inputMode="url"
            placeholder="https://example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            spellCheck={false}
            autoComplete="off"
          />
          <button onClick={run} disabled={loading}>
            {loading ? "Checking…" : "Run check"}
          </button>
        </div>
        <p className="hint">
          Runs server-side against the live endpoint. Internal targets like{" "}
          <code>localhost</code> and private IPs are refused. Nothing is stored.
        </p>
      </section>

      {error && (
        <div className="result">
          <div className="notice">
            <div className="k">Could not check</div>
            {error}
          </div>
        </div>
      )}

      {result && (
        <div className="result">
          {result.inconclusive ? (
            <div className="notice">
              <div className="k">Inconclusive</div>
              {result.note}
            </div>
          ) : (
            <>
              <div className="report-head">
                <div className="seal" data-band={band(result.grade.letter)}>
                  <span className="letter">{result.grade.letter}</span>
                  <span className="score">{result.grade.score}/100</span>
                </div>
                <div className="report-meta">
                  <span className="target">{result.target}</span>
                  <span className="sub">
                    {result.findings.length === 0
                      ? "No breaking-change signals"
                      : `${result.findings.length} finding${
                          result.findings.length === 1 ? "" : "s"
                        }`}{" "}
                    · checked {new Date(result.checkedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {result.findings.length === 0 ? (
                <div className="findings">
                  <div className="clear">
                    <b>Ready.</b> No 2026-07-28 breaking-change signals were
                    observed on this endpoint.
                  </div>
                </div>
              ) : (
                <div className="findings">
                  {result.findings.map((f: Finding) => (
                    <article
                      className="finding"
                      data-sev={f.severity}
                      key={f.ruleId}
                    >
                      <div className="top">
                        <span className="tag" data-sev={f.severity}>
                          {f.severity}
                        </span>
                        <span className="title">{f.title}</span>
                        <span className="rid">{f.ruleId}</span>
                      </div>
                      {f.location && <div className="loc">{f.location}</div>}
                      <div className="detail">{f.detail}</div>
                      <div className="fix">
                        <b>Fix</b> · {f.fix}
                      </div>
                      <div className="spec">
                        <a href={f.specRef} target="_blank" rel="noreferrer">
                          {f.specRef}
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <footer className="foot">
        <span>
          Deterministic checker · no LLM, no stored data. Findings are signals
          to review against the canonical spec.
        </span>
        <span>
          Also available as a CLI and an MCP server —{" "}
          <a href="https://github.com/AlpayC" target="_blank" rel="noreferrer">
            source on GitHub
          </a>
          .
        </span>
      </footer>
    </main>
  );
}
