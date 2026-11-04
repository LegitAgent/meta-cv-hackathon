import { useState } from "react";
import { sendCommand } from "../store";

export function ConnectionSettings({ backendUrl, onSaved }: { backendUrl: string; onSaved: () => Promise<void> }) {
  const [url, setUrl] = useState(backendUrl);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const target = new URL(url);
      if (target.username || target.password || target.search || target.hash || target.pathname !== "/")
        throw new Error("Enter the backend origin only, such as https://backtrack-api.example.workers.dev");
      if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1"))
        throw new Error("Use HTTPS, or http://127.0.0.1:8001 for local development.");
      if (target.protocol === "https:") {
        const granted = await chrome.permissions.request({ origins: [`${target.origin}/*`] });
        if (!granted) throw new Error("Chrome permission is needed to connect to this backend.");
      }
      await chrome.storage.session.set({ backendCredential: { origin: target.origin, token: token.trim() } });
      await sendCommand({ type: "WORKSPACE_UPDATE", fields: { backendUrl: target.origin } });
      setToken("");
      setMessage("Connection saved. The access token lasts until Chrome restarts.");
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Connection could not be saved."); }
    finally { setBusy(false); }
  }
  return <details className="card">
    <summary>Connection settings</summary>
    <label>Backend URL<input aria-label="Backend URL" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label>Backend access token<input aria-label="Backend access token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
    <p className="hint">Use your Backtrack demo token here. Provider API keys belong only on the backend. Saving an empty token clears it.</p>
    <button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save connection"}</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
