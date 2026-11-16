# Agent guide: install Atlas and connect a vault

Read this before setting up Reprobates Atlas for someone. The app repository and the user’s content repository are separate. Never place a user’s vault inside the app repository or an installer.

## Ask the vault question first

Ask: **“Which existing Obsidian vault would you like Atlas to use, or would you like to begin a brand-new vault?”**

If they choose an existing vault, confirm the actual folder from their answer or Obsidian’s vault list. Do not assume a folder named Reprobates is the right one. If they choose a new vault, get the name and destination, then create it through Atlas’s welcome screen. If they already supplied these choices in the session, use them without asking again.

## Install and open

1. Determine the operating system and architecture. The release supports Apple Silicon macOS and x64 Windows.
2. Download the matching installer from <https://github.com/NateGrenade/reprobates_atlas/releases/latest>. macOS: move the app from the DMG to Applications. Windows: run the installer.
3. This release is unsigned/not notarized. Use the operating system’s normal approval flow if needed; do not disable Gatekeeper, antivirus, or system-wide security controls.
4. Launch Atlas. Select **Choose the vault folder**, **Clone**, or **Create**, according to the user’s choice. Existing vaults receive Atlas’s own setup files under `Atlas/`; do not rewrite or migrate the lore.
5. Check that the vault name/path is correct in **Settings → General**, that expected files are visible, and that Write and Assistant are available. Do not invent canon or draft manuscript prose as a setup test.

You can also build locally using Node.js 24+ and the commands in README.md. Do not copy any developer’s `dev-vault`, app settings, login state, or chat history into an installation.

## Configure content sync separately

Ask whether they want GitHub content sync if they have not said so. Use a repository owned by or explicitly shared with the user. Ask for the repository and visibility before creating one; private is appropriate for unpublished writing. Do not choose a public content repository by default.

- **Existing vault with Git/remote:** inspect `git status` and `git remote -v`. Preserve uncommitted work and the existing remote. Do not reset, force-push, or replace history. Start with Manual while verifying the connection; enable Auto when the user wants ongoing sync.
- **Existing content on GitHub, not yet local:** clone through Atlas’s welcome screen, using a new destination folder. Open the resulting folder as a vault in Obsidian too.
- **Local vault with a new empty repository:** use **Settings → General → Vault sync → Connect**. Connecting initializes Git if necessary but uploads nothing. Review `.gitignore` and the chosen visibility. Only when publishing is authorized, use **Publish existing files → Publish vault**; this includes existing Git history. The remote must be empty. Then select Auto if desired.
- **Local-only vault:** leave sync Off/unconfigured. GitHub is optional.

Git must be installed and authenticated as the user. For HTTPS GitHub, `gh auth login` and `gh auth setup-git` configure the user’s credential flow; SSH remotes use their existing SSH setup. Never request tokens in chat or bake credentials into the app or URLs. Handle account sign-in through the normal local credential flow.

Auto sync commits only files changed by Atlas, including Writer saves, and pulls remote changes every two minutes. Explicit initial publishing adds eligible existing files; normal sync does not stage unrelated external edits. Pending Atlas writes persist across restarts. Conflicts stop sync for review, with both versions available. If Obsidian Git manages this same folder, choose one automatic sync owner to avoid competing jobs.

## Verify the setup

Confirm the selected vault path and content remote independently of the app’s release source. Check the sync status and resolve authentication errors rather than claiming that attaching a URL proves sync works. With permission to create a small test note, verify it appears in the content remote after Sync now, then remove it through Atlas and sync the deletion; otherwise report the non-writing checks performed. Do not use the manuscript for a disposable test.

Check **Settings → About → Check for updates**. App releases come from `NateGrenade/reprobates_atlas`; content comes from the vault’s remote. macOS downloads a DMG for manual replacement. Windows installs a downloaded update on quit. App updates must not replace or re-clone the vault.

## Working on the source

- `src/main`: Electron, filesystem, sync wiring, app updates, Atlas Live.
- `src/renderer/src`: map, timeline, Inspector, files, settings.
- `core`: byte-preserving note operations, data model, Git sync.
- `addons/writer`: manuscript editor and Markdown storage. Never use its rich editor for lore notes.
- `addons/assistant`: model controls and approval-gated Atlas tools. Prose drafting is opt-in per session.
- `templates/Atlas/README.md`: vault data contract.

Use small changes and focused tests. Preserve unrelated work. Run `npm run typecheck`, `npm test`, and a release build for packaging changes. Never commit vault content, private screenshots, credentials, generated installers, or personal account settings. Use `docs/release.md` for version tags and the release workflow.
