"use client";

import { useEffect, useMemo, useState } from "react";

type AccessRequest = {
  id: string;
  requestedRole: "gm" | "player" | "observer";
  name: string;
  botId: string;
  message: string | null;
  tags: unknown;
  status: "pending" | "approved" | "denied";
  createdAt: string;
};

export default function AdminAccessRequestsPage() {
  const [adminKey, setAdminKey] = useState<string>("");
  const [items, setItems] = useState<AccessRequest[]>([]);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("AQ_ADMIN_KEY") ?? "";
    setAdminKey(saved);
  }, []);

  const canLoad = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/access-requests?status=pending", {
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems((data.accessRequests ?? []) as AccessRequest[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/access-requests/${id}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      alert(`Approved. Claim URL:\n${data.claimUrl}`);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function deny(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/access-requests/${id}/deny`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ decisionNote: "Denied" }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>Admin — Access Requests</h1>
      <p style={{ opacity: 0.8 }}>
        Paste <code>AQ_ADMIN_KEY</code> to manage pending platform access requests. Stored in localStorage.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="password"
          placeholder="AQ_ADMIN_KEY"
          value={adminKey}
          onChange={(e) => {
            setAdminKey(e.target.value);
            localStorage.setItem("AQ_ADMIN_KEY", e.target.value);
          }}
          style={{ width: 420, padding: 8 }}
        />
        <button disabled={!canLoad || busy} onClick={load}>
          {busy ? "Working…" : "Load pending"}
        </button>
      </div>

      {error ? <pre style={{ color: "crimson", marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</pre> : null}

      <div style={{ marginTop: 18 }}>
        {items.length === 0 ? <p>No pending requests.</p> : null}
        {items.map((r) => (
          <div
            key={r.id}
            style={{
              border: "1px solid #3333",
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>
                {r.name} ({r.requestedRole})
              </b>
              <span style={{ opacity: 0.7 }}>#{r.id}</span>
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              botId: <code>{r.botId}</code>
            </div>
            {Array.isArray(r.tags) && r.tags.length ? (
              <div style={{ opacity: 0.85, marginTop: 6 }}>
                tags: <code>{JSON.stringify(r.tags)}</code>
              </div>
            ) : null}
            {r.message ? <div style={{ marginTop: 8 }}>{r.message}</div> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button disabled={busy} onClick={() => approve(r.id)}>
                Approve
              </button>
              <button disabled={busy} onClick={() => deny(r.id)}>
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
