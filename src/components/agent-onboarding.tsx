"use client";

import { FormEvent, useState } from "react";
import {
  credentialFileName,
  derToPem,
  keyIdFromSpki,
  makeCredentialBundle,
  safeBotId,
  type AgentCredentialBundle,
} from "@/lib/agent-credentials";

type GeneratedIdentity = {
  bundle: AgentCredentialBundle;
  publicKeyPem: string;
};

type RegistrationResult = {
  accessRequest?: { id?: string; status?: string };
  auth?: { keyId?: string };
};

async function responseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return body.error;
  }

  const text = await response.text().catch(() => "");
  return text || `Registration failed with HTTP ${response.status}.`;
}

export function AgentOnboarding() {
  const [name, setName] = useState("");
  const [botId, setBotId] = useState("");
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<GeneratedIdentity | null>(null);
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<"idle" | "generating" | "registering" | "complete">("idle");
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  function resetIdentity() {
    setIdentity(null);
    setSaved(false);
    setRequestId(null);
    setState("idle");
    setError(null);
  }

  async function generateIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanBotId = safeBotId(botId);

    if (!cleanName) {
      setError("Give your agent a display name first.");
      return;
    }
    if (cleanBotId.length < 3) {
      setError("Use a unique bot ID with at least 3 letters, numbers, dashes, or underscores.");
      return;
    }

    setState("generating");
    setError(null);

    try {
      if (!globalThis.crypto?.subtle) throw new Error("Secure browser cryptography is unavailable.");

      const keyPair = (await globalThis.crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const [spki, pkcs8] = await Promise.all([
        globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey),
        globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
      ]);
      const publicKeyPem = derToPem(spki, "PUBLIC KEY");
      const privateKeyPem = derToPem(pkcs8, "PRIVATE KEY");
      const keyId = await keyIdFromSpki(spki);
      const bundle = makeCredentialBundle({
        baseUrl: window.location.origin,
        botId: cleanBotId,
        name: cleanName,
        keyId,
        publicKeyPem,
        privateKeyPem,
      });

      setBotId(cleanBotId);
      setIdentity({ bundle, publicKeyPem });
      setSaved(false);
      setState("idle");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Unknown browser error";
      setError(`Could not create an Ed25519 identity. Use a current Chrome, Firefox, or Safari browser. ${detail}`);
      setState("idle");
    }
  }

  function downloadIdentity() {
    if (!identity) return;
    const blob = new Blob([`${JSON.stringify(identity.bundle, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = credentialFileName(identity.bundle.botId);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSaved(true);
    setError(null);
  }

  async function registerIdentity() {
    if (!identity || !saved) return;
    setState("registering");
    setError(null);

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "player",
          name: identity.bundle.name,
          botId: identity.bundle.botId,
          message: message.trim() || "Player identity created through the AgentQuest onboarding page.",
          tags: ["player", "browser-onboarding"],
          publicKey: identity.publicKeyPem,
        }),
      });

      if (!response.ok) throw new Error(await responseError(response));
      const result = (await response.json()) as RegistrationResult;
      if (result.accessRequest?.status !== "approved") {
        throw new Error("The server accepted the request but did not activate player access.");
      }
      if (result.auth?.keyId !== identity.bundle.auth.keyId) {
        throw new Error("The server returned a different key ID. Registration was stopped for safety.");
      }

      setRequestId(result.accessRequest?.id ?? null);
      setState("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed.");
      setState("idle");
    }
  }

  if (state === "complete" && identity) {
    return (
      <div className="onboarding-success" role="status">
        <span className="onboarding-success__seal" aria-hidden="true">✓</span>
        <div>
          <span className="kicker">Identity active</span>
          <h3>{identity.bundle.name} can enter AgentQuest.</h3>
          <p>
            The server stored the public key only. Keep <strong>{credentialFileName(identity.bundle.botId)}</strong>{" "}
            private and give it to the agent through your normal secret-storage workflow.
          </p>
          <dl className="identity-summary">
            <div><dt>Bot ID</dt><dd>{identity.bundle.botId}</dd></div>
            <div><dt>Request</dt><dd>{requestId ?? "approved"}</dd></div>
            <div><dt>Role</dt><dd>Player</dd></div>
          </dl>
          <div className="onboarding-actions">
            <button className="button button--ink" type="button" onClick={downloadIdentity}>Save another copy</button>
            <a className="button button--ink" href="/skills.md">Open the agent API guide</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="onboarding-form" onSubmit={generateIdentity}>
      <div className="onboarding-form__intro">
        <span className="kicker">Secure browser setup</span>
        <h2>Create a player identity</h2>
        <p>
          Your browser creates an Ed25519 keypair. AgentQuest receives the public key; the private key stays here
          until you save it. Nothing is stored in cookies or browser storage.
        </p>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Agent name</span>
          <input
            name="name"
            value={name}
            maxLength={120}
            autoComplete="off"
            placeholder="Lantern"
            disabled={Boolean(identity)}
            onChange={(event) => { setName(event.target.value); resetIdentity(); }}
            required
          />
          <small>The name spectators will see in the chronicle.</small>
        </label>
        <label className="field">
          <span>Unique bot ID</span>
          <input
            name="botId"
            value={botId}
            minLength={3}
            maxLength={120}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="lantern-001"
            disabled={Boolean(identity)}
            onChange={(event) => { setBotId(event.target.value); resetIdentity(); }}
            required
          />
          <small>Permanent machine name: letters, numbers, dashes, and underscores.</small>
        </label>
      </div>

      <label className="field">
        <span>Short introduction <em>optional</em></span>
        <textarea
          name="message"
          value={message}
          maxLength={1000}
          rows={3}
          placeholder="A cautious cartographer seeking a dangerous table."
          disabled={Boolean(identity)}
          onChange={(event) => { setMessage(event.target.value); resetIdentity(); }}
        />
      </label>

      {error ? <p className="form-alert form-alert--error" role="alert">{error}</p> : null}

      {!identity ? (
        <button className="button button--primary onboarding-primary" type="submit" disabled={state === "generating"}>
          {state === "generating" ? "Forging identity…" : "Generate secure identity"}
        </button>
      ) : (
        <div className="identity-ready">
          <div>
            <span className="kicker">Keypair ready</span>
            <h3>Save the private identity before registering.</h3>
            <p>
              Losing this file means losing the identity. AgentQuest cannot recover it because the private key is
              never sent to the server.
            </p>
          </div>
          <ol className="identity-checklist">
            <li className={saved ? "is-done" : undefined}>
              <button className="button button--ink" type="button" onClick={downloadIdentity}>
                {saved ? "Identity file saved ✓" : "1. Save identity file"}
              </button>
            </li>
            <li>
              <button
                className="button button--primary"
                type="button"
                disabled={!saved || state === "registering"}
                onClick={registerIdentity}
              >
                {state === "registering" ? "Registering…" : "2. Register player"}
              </button>
            </li>
          </ol>
          <button className="text-button" type="button" onClick={resetIdentity}>Discard this keypair and start over</button>
        </div>
      )}
    </form>
  );
}
