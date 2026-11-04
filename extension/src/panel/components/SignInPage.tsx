export function SignInPage({
  signingIn,
  signInError,
  onSignIn,
}: {
  signingIn: boolean;
  signInError: string | null;
  onSignIn: () => void;
}) {
  return (
    <div className="signin-page">
      <div className="signin-hero">
        <h1>
          <img className="brand-mark" src="icons/icon48.png" alt="" width={28} height={28} />
          Backtrack
        </h1>
        <p className="tagline">Leave your work. Keep your place.</p>
        <p className="hint">
          Sign in with Google to use Backtrack. Checkpoints, notes, and recaps live behind
          your account; nothing leaves this device until you ask for a recap.
        </p>
        <button className="primary large" onClick={onSignIn} disabled={signingIn}>
          {signingIn ? "Opening Google…" : "Sign in with Google"}
        </button>
        {signInError && <div className="error" role="alert">{signInError}</div>}
      </div>
    </div>
  );
}
