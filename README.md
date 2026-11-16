# Reprobates Atlas

A local desktop workspace for an Obsidian vault: a spatial map, timeline, character cards, plain-file editor, manuscript writer, and an optional Codex / Claude assistant. Files remain readable in Obsidian and Git.

## Install

Download the latest installer from [GitHub Releases](https://github.com/NateGrenade/reprobates_atlas/releases/latest).

- **macOS, Apple Silicon:** open the `.dmg` and drag Reprobates Atlas into Applications. This build is not notarized. If macOS blocks it, use the system’s **Privacy & Security → Open Anyway** control after verifying the download source.
- **Windows, x64:** run `Reprobates-Atlas-Setup-<version>.exe`. Windows may show an unknown-publisher prompt for this unsigned build.

On first launch, choose an existing Obsidian vault folder, clone its repository, or create a new vault. You can use Atlas and Obsidian on the same folder. Existing prose stays in place; Atlas adds its configuration under `Atlas/`. The **Write** tab only edits manuscript documents under `Manuscript/`.

For an agent helping with installation, start with [AGENTS.md](AGENTS.md). It includes the required vault-choice question and verification steps.

## Two independent kinds of update

**The app:** Atlas checks this repository’s published GitHub Releases on launch. You can also use **Settings → About → Check for updates**. A source commit alone does not release an app: a version tag builds and publishes installers. Windows downloads the update and installs on quit. The Mac build downloads a new DMG, which you use to replace the app in Applications. Your vault remains in its own folder.

**Your content:** your vault has a separate Git repository and remote. Install Git and authenticate with your own account (GitHub CLI’s `gh auth login` followed by `gh auth setup-git` works for HTTPS). Credentials are never included in Atlas.

- An existing Git vault retains its remote. Choose **Auto**, **Manual**, or **Off** from the sync light or **Settings → General**.
- For a local vault without a remote, enter its repository URL in **Settings → General → Vault sync → Connect**. This starts in Manual mode and does not upload anything.
- To publish an existing local vault into an **empty** repository, use **Publish existing files → Publish vault**. This publishes eligible files and existing Git history. Check the repository visibility and `.gitignore` first.
- To use a repository that already contains content, **Clone** it on the welcome screen, then open that same folder in Obsidian.
- Auto pulls every two minutes and commits/pushes Atlas changes after 30 seconds of inactivity. Pending writes survive a restart. Atlas stages only files it changed during normal sync, including Writer documents; edits made in other apps remain for those apps or your Git workflow to commit.
- Conflicts pause sync for you to review. Atlas does not force-push. For one folder shared with Obsidian Git, use one automatic sync owner: disable Obsidian’s automatic Git jobs while Atlas Auto is on, or set Atlas Off and use Obsidian Git.

A vault does not need Git to work locally. Network errors leave local work intact.

## Writer and assistant

Writer stores Markdown in `Manuscript/<Book>/<Chapter>.md`, with CriticMarkup comments and suggestions. Page settings and version snapshots are local Atlas app data; they are not part of vault sync. Lore notes keep the plain-file editor and are never passed through the rich editor. DOCX, PDF, and Markdown import/export are available from Writer; Google Docs can be exported as DOCX and imported without a Drive connection.

The Assistant uses separately installed, signed-in **Codex CLI** or **Claude Code**. Choose the provider, model, and reasoning in its compact controls. Atlas tools can inspect the app and propose file, manuscript, and planet changes; edits wait for **Apply** or **Skip** inside Atlas. Prose drafting needs the session’s explicit permission. Account credentials and chat history stay on the computer.

## Develop

Requires Node.js 24+, npm, and Git.

```sh
npm ci
npm run typecheck
npm test
npm run dev:personal
```

Development defaults to `dev-vault/`; create an empty folder there or set `ATLAS_VAULT` to a disposable copy. Do not test editing or sync against someone’s live vault. `npm run addons` builds the bundled Assistant and Writer. The optional local E2E suite currently needs the pinned development-vault fixture; unit tests do not need private content.

```sh
npm run dist:mac   # Apple Silicon Mac
npm run dist:win   # Windows x64, on Windows
```

Both release builds include Writer and Assistant, excluding the sample/test add-on. See [release instructions](docs/release.md) and the [vault data contract](templates/Atlas/README.md).
