import { useEffect, useState } from "react";
import { getCredential, signIn, signOut, type Credential } from "../auth";
import { BACKEND_URL } from "../../shared/config";

export function AccountSettings() {
  const [credential, setCredential] = useState<Credential | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getCredential(BACKEND_URL).then(value => { if (active) setCredential(value); }).catch(() => { if (active) setCredential(null); }); };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function login() {
    setBusy(true); setMessage("");
    try {
      const user = await signIn(BACKEND_URL);
      setCredential(user); setMessage(`Signed in as ${user.email}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await signOut(); setCredential(null); setMessage("Signed out of Backtrack."); }
    catch { setMessage("Could not sign out. Try again."); }
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
