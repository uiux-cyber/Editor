# Releasing a new version

Installed copies of Kinora (1.2 and later) update themselves from this repository's
[GitHub releases](https://github.com/uiux-cyber/Editor/releases). Publishing a release is all it
takes for every user to get it.

## How users get an update

1. About 20 seconds after Kinora starts, and then every 4 hours, it checks the latest release.
2. If there is a newer version, it downloads the installer in the background and checks its
   SHA-512 checksum against `latest.yml`. A file that doesn't match is thrown away.
3. An **Update** button appears in the title bar, with a short "What's new" from the release
   notes. **Restart now** saves-or-asks about unsaved work and running exports, then installs and
   reopens Kinora. Otherwise the update installs silently the next time Kinora is closed.

Users can check by hand (Help → Check for updates…) and turn automatic updates off in
Settings → Updates. Development builds and automated tests never contact GitHub.

## Publish a release

1. **Write the release notes** in `docs/releases/v<version>.md` (Markdown, shown on the release
   page and in the app's "What's new"). Without a file, GitHub generates notes from the commits.
2. **Bump the version, commit and tag** in one step:

   ```bash
   npm version 1.3.0
   ```

   This updates `package.json` and `package-lock.json`, commits, and creates the tag `v1.3.0`.
   Use `npm version patch` / `minor` / `major` to bump automatically.
3. **Push the commit and the tag:**

   ```bash
   git push --follow-tags
   ```

4. The [Release workflow](../.github/workflows/release.yml) type-checks, runs the unit tests,
   downloads the AI models, builds the installer and publishes the release with three files:
   `Kinora-Setup-<version>.exe`, its `.blockmap`, and `latest.yml`. It takes about 15–25 minutes;
   follow it under the repository's **Actions** tab.

The workflow refuses to publish if the tag and the version in `package.json` differ.

## Dry run

Run the **Release** workflow by hand (Actions → Release → Run workflow). It does everything except
publish, and keeps the installer as a downloadable build artifact for 7 days.

## If a release is broken

Users only ever move forward to a higher version, so fix it with a new release: bump the patch
version (`npm version patch`) and push. Deleting a bad release stops further downloads of it, but
copies that already installed it stay on it until the next release.

## Code signing (recommended)

The installer is not signed yet, so Windows SmartScreen warns on first install. To sign:

1. Get a code-signing certificate (or use Microsoft Trusted Signing).
2. Add it to the repository secrets as `CSC_LINK` (the `.pfx`, base64) and `CSC_KEY_PASSWORD`,
   and pass both to the "Build the installer" step as environment variables; electron-builder
   then signs automatically.
3. Once releases are signed, electron-builder records the publisher name, and installed copies
   check it on every update, so a tampered installer is refused even if its checksum file were
   replaced too.

## Testing the updater locally

The `updates` end-to-end scenario serves a fake update from a local web server
(`KINORA_UPDATE_FEED`, honoured only during automated tests) and checks the download, the
checksum, the title-bar button, the "What's new" dialog and the Settings page, without ever
running an installer:

```bash
npm run build
node scripts/e2e.mjs updates
```
