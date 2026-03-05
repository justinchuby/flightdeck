/**
 * Displays the app version and git commit hash next to the logo.
 * The hash is always shown so developers can identify the exact build.
 */
export function VersionBadge() {
  const version = __APP_VERSION__;
  const gitHash = __GIT_HASH__;

  const showHash = gitHash && gitHash !== 'unknown';
  const displayText = showHash ? `v${version} (${gitHash})` : `v${version}`;

  return (
    <span
      className="text-[11px] text-th-text-muted font-normal select-all"
      title={`Version ${version} — ${gitHash}`}
    >
      {displayText}
    </span>
  );
}
