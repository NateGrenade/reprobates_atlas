# Releasing Reprobates Atlas

The application repository is `NateGrenade/reprobates_atlas`. Vault content belongs in a different repository. No vault, account credentials, or chat history may be included in a release.

## Publish a version

1. Update the version in `package.json` and `package-lock.json`, then run `npm run typecheck` and `npm test`.
2. Commit the change, push the app branch, tag that commit (for example `v0.2.1`), and push the tag.
3. `.github/workflows/release.yml` checks the tag against the package version, installs from the lockfile, runs typechecking/tests, and builds macOS arm64 DMG/ZIP and Windows x64 NSIS installers. Both builds include Writer and Assistant.
4. Only after both builds succeed, the publish job creates the GitHub Release with installers, blockmaps, `latest.yml`, and `latest-mac.yml`. Inspect the assets and edit the release notes if needed.

The workflow uses the repository-scoped `GITHUB_TOKEN` with `contents: write`; no personal token is packaged. A failed build does not publish a partial release. A source push without a version tag does not distribute a new app.

For local builds use `npm run dist:mac` on Apple Silicon or `npm run dist:win` on Windows. Outputs go into ignored `dist/`.

## Update behavior

The public release feed is <https://api.github.com/repos/NateGrenade/reprobates_atlas/releases/latest>. Windows uses electron-updater and release metadata, downloading in the background and installing on quit. The update notice appears only after download succeeds. macOS checks the release API and offers its matching DMG. Open the download and replace the app in Applications. Neither updater touches the vault directory or its Git remote.

The Mac build is unsigned and not notarized. Fully automatic Mac replacement requires an Apple Developer ID distribution certificate and notarization; do not substitute an Apple Development certificate. Add signing/notarization secrets and switch Mac to electron-updater when these are available. Current macOS updates use the supported download-and-replace flow. Windows is also unsigned; its installer may show an unknown-publisher prompt.

The default feed is for a public app repository. Private vault repositories work through the user’s local Git credentials. Private **app release feeds** need separately configured authenticated distribution; never embed a personal access token in a public installer.

## Verify locally

Serve a JSON feed shaped like GitHub Releases:

```json
{"tag_name":"v9.9.9","assets":[{"name":"Reprobates-Atlas-9.9.9-arm64.dmg","browser_download_url":"http://127.0.0.1:8765/update.dmg"}]}
```

Run the app with `ATLAS_UPDATE_FEED=http://127.0.0.1:8765/latest.json`, a disposable `ATLAS_VAULT`, and isolated `ATLAS_USER_DATA`. Optionally set `ATLAS_DOWNLOAD_DIR` for a test download. Check the version notice, download result, and missing/bad feed message in Settings → About. Unit tests cover version ordering, architecture selection, failure reporting, and Windows download completion.
