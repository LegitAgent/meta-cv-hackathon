import { useState } from "react";
import { signIn, signOut, useCredential } from "../auth";
import { BACKEND_URL } from "../../shared/config";

export function AccountSettings({ onAuthChange }: { onAuthChange?: () => void }) {
  const { credential, refresh } = useCredential(BACKEND_URL);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login() {
    setBusy(true); setMessage("");
    try {
      const user = await signIn(BACKEND_URL);
      setMessage("Signed in.");
      await refresh();
      onAuthChange?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      await signOut();
      setMessage("Signed out of Backtrack.");
      await refresh();
      onAuthChange?.();
    } catch { setMessage("Could not sign out. Try again."); }
    finally { setBusy(false); }
  }
  return <details className="card">
    <summary>Account</summary>
    <p className="hint">Sign in with a Gmail account to generate recaps. Notes stay on this device. No access to your inbox is requested.</p>
    {credential && <p>Signed in as {credential.email}</p>}
    <button disabled={busy} onClick={() => void login()}>{busy ? "Please wait…" : credential ? "Switch Google account" : "Sign in with Google"}</button>
    {credential && <button disabled={busy} onClick={() => void logout()}>Sign out</button>}
    {message && <p role="status">{message}</p>}
  </details>;
}
