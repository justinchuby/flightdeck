# Homebrew Distribution & Auto-Updates — Flightdeck Desktop

## Overview

Flightdeck Desktop is distributed outside the Mac App Store via:

1. **Direct DMG download** from GitHub Releases (primary)
2. **Homebrew Cask** for CLI-driven install (`brew install --cask flightdeck`)
3. **Homebrew Formula** for the CLI-only Node.js version (`brew install flightdeck`)
4. **Auto-updates** via `electron-updater` using GitHub Releases as the update feed

---

## Homebrew Cask (Desktop App)

### Tap Repository Structure

Create a dedicated GitHub repository: `flightdeck-ai/homebrew-flightdeck`

```
homebrew-flightdeck/
├── Casks/
│   └── flightdeck.rb         # Desktop app (Electron)
├── Formula/
│   └── flightdeck-cli.rb     # CLI-only (Node.js via npm)
├── README.md
└── .github/
    └── workflows/
        └── update-cask.yml   # Auto-update cask on release
```

### Cask Definition

```ruby
# Casks/flightdeck.rb
cask "flightdeck" do
  arch arm: "arm64", intel: "x64"

  version "0.4.0"
  sha256 arm:   "PLACEHOLDER_ARM64_SHA256",
         intel: "PLACEHOLDER_X64_SHA256"

  url "https://github.com/flightdeck-ai/flightdeck/releases/download/v#{version}/Flightdeck-#{version}-mac-#{arch}.dmg",
      verified: "github.com/flightdeck-ai/flightdeck/"
  name "Flightdeck"
  desc "Multi-agent AI orchestration platform"
  homepage "https://github.com/flightdeck-ai/flightdeck"

  # Require macOS 13+ (Ventura) for modern Electron support
  depends_on macos: ">= :ventura"

  app "Flightdeck.app"

  # Desktop integration
  binary "#{appdir}/Flightdeck.app/Contents/MacOS/flightdeck-cli", target: "flightdeck"

  # Cleanup on uninstall
  zap trash: [
    "~/Library/Application Support/Flightdeck",
    "~/Library/Preferences/com.flightdeck.app.plist",
    "~/Library/Caches/com.flightdeck.app",
    "~/Library/Logs/Flightdeck",
    "~/.flightdeck",
  ]

  caveats <<~EOS
    Flightdeck requires AI CLI tools to be installed separately:
      - GitHub Copilot CLI: npm install -g @anthropic-ai/copilot
      - Gemini CLI: npm install -g @google/gemini-cli
      - Claude Code: npm install -g @anthropic-ai/claude-code

    See https://github.com/flightdeck-ai/flightdeck for setup instructions.
  EOS
end
```

### Universal Binary Alternative

If building universal (arm64+x64 in one binary):

```ruby
cask "flightdeck" do
  version "0.4.0"
  sha256 "PLACEHOLDER_UNIVERSAL_SHA256"

  url "https://github.com/flightdeck-ai/flightdeck/releases/download/v#{version}/Flightdeck-#{version}-mac-universal.dmg",
      verified: "github.com/flightdeck-ai/flightdeck/"
  name "Flightdeck"
  desc "Multi-agent AI orchestration platform"
  homepage "https://github.com/flightdeck-ai/flightdeck"

  depends_on macos: ">= :ventura"

  app "Flightdeck.app"

  zap trash: [
    "~/Library/Application Support/Flightdeck",
    "~/Library/Preferences/com.flightdeck.app.plist",
    "~/Library/Caches/com.flightdeck.app",
    "~/.flightdeck",
  ]
end
```

### CLI-Only Formula

For users who prefer the terminal-only experience:

```ruby
# Formula/flightdeck-cli.rb
class FlightdeckCli < Formula
  desc "Multi-agent AI orchestration platform (CLI)"
  homepage "https://github.com/flightdeck-ai/flightdeck"
  url "https://registry.npmjs.org/@flightdeck-ai/flightdeck/-/flightdeck-0.4.0.tgz"
  sha256 "PLACEHOLDER_NPM_SHA256"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/flightdeck --version")
  end
end
```

### User Installation

```bash
# Install the desktop app
brew tap flightdeck-ai/flightdeck
brew install --cask flightdeck

# Or install CLI-only
brew install flightdeck-ai/flightdeck/flightdeck-cli

# Update
brew upgrade --cask flightdeck
```

---

## Auto-Update Strategy

### electron-updater Configuration

electron-updater uses GitHub Releases as the update source. On each app launch
(and periodically), it checks for new releases.

```typescript
// packages/desktop/src/updater.ts
import { autoUpdater } from 'electron-updater';
import { BrowserWindow, dialog } from 'electron';
import log from 'electron-log';

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  // Use electron-log for updater logging
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup and every 4 hours
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);

  // Notify renderer about update availability
  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('updater:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('updater:downloaded', {
      version: info.version,
    });

    // Show native dialog
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Flightdeck ${info.version} has been downloaded.`,
        detail: 'The update will be installed when you restart the app.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error);
  });
}
```

### electron-builder publish config

```yaml
# In electron-builder.yml
publish:
  provider: github
  owner: flightdeck-ai
  repo: flightdeck
  releaseType: release    # Only check stable releases, not pre-releases
```

### Update Flow

```
App Launch
  │
  ├─ autoUpdater.checkForUpdatesAndNotify()
  │
  ├─ GitHub API: GET /repos/flightdeck-ai/flightdeck/releases/latest
  │   └─ Compare app version with latest release tag
  │
  ├─ If update available:
  │   ├─ Download in background (delta update if supported)
  │   ├─ Notify renderer: 'updater:available'
  │   ├─ On download complete: 'updater:downloaded'
  │   └─ Prompt user: "Restart Now" or "Later"
  │
  └─ If no update: silent, no notification

On "Restart Now":
  │
  ├─ autoUpdater.quitAndInstall()
  ├─ Graceful server shutdown
  ├─ Replace app binary
  └─ Restart app with new version
```

### Update Files Generated by electron-builder

For macOS, electron-builder generates these files alongside the DMG:

```
release/
├── Flightdeck-0.4.0-mac-arm64.dmg
├── Flightdeck-0.4.0-mac-arm64.dmg.blockmap    # Delta update data
├── Flightdeck-0.4.0-mac-arm64.zip             # For auto-update (Squirrel)
├── Flightdeck-0.4.0-mac-arm64.zip.blockmap
├── latest-mac.yml                              # Update metadata
├── Flightdeck-0.4.0-win-x64.exe               # Windows NSIS installer
├── Flightdeck-0.4.0-win-x64.exe.blockmap
├── latest.yml                                  # Windows update metadata
├── Flightdeck-0.4.0-linux-x86_64.AppImage
└── latest-linux.yml                            # Linux update metadata
```

The `latest-mac.yml` file looks like:

```yaml
version: 0.4.0
files:
  - url: Flightdeck-0.4.0-mac-arm64.zip
    sha512: <hash>
    size: 157286400
    blockMapSize: 164320
path: Flightdeck-0.4.0-mac-arm64.zip
sha512: <hash>
releaseDate: '2026-03-12T15:00:00.000Z'
```

---

## Versioning Strategy

### Semantic Versioning

Follow semver strictly. The version in `packages/desktop/package.json` must match
the root `package.json` version.

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └─ Bug fixes, security patches
  │     └─ New features, non-breaking changes
  └─ Breaking changes, major redesigns
```

### Release Process

```
1. Update version in root package.json
   └─ npm version patch/minor/major

2. All workspace package.json versions update via npm workspaces

3. Create git tag: v0.4.1

4. Push tag to GitHub
   └─ Triggers CI/CD build

5. GitHub Actions:
   ├─ Build macOS (universal DMG + ZIP)
   ├─ Build Windows (NSIS installer)
   ├─ Build Linux (AppImage + deb + rpm)
   ├─ Code sign + notarize (macOS)
   ├─ Code sign (Windows)
   └─ Create GitHub Release with all artifacts

6. Auto-update:
   └─ Existing installs detect new release within 4 hours

7. Homebrew cask:
   └─ CI updates cask formula SHA + version (automated)
```

---

## CI/CD: GitHub Actions for Release

### Release Workflow

```yaml
# .github/workflows/desktop-release.yml
name: Desktop Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build all packages
        run: npm run build

      - name: Build Electron (macOS)
        working-directory: packages/desktop
        run: npx electron-builder --mac --universal
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Code signing
          CSC_LINK: ${{ secrets.MAC_CERTIFICATE_P12_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          # Notarization
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - name: Upload macOS artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-mac
          path: |
            packages/desktop/release/*.dmg
            packages/desktop/release/*.zip
            packages/desktop/release/*.blockmap
            packages/desktop/release/latest-mac.yml

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build all packages
        run: npm run build

      - name: Build Electron (Windows)
        working-directory: packages/desktop
        run: npx electron-builder --win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WIN_CSC_LINK: ${{ secrets.WIN_CERTIFICATE_P12_BASE64 }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERTIFICATE_PASSWORD }}

      - name: Upload Windows artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-win
          path: |
            packages/desktop/release/*.exe
            packages/desktop/release/*.exe.blockmap
            packages/desktop/release/latest.yml

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build all packages
        run: npm run build

      - name: Build Electron (Linux)
        working-directory: packages/desktop
        run: npx electron-builder --linux
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload Linux artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-linux
          path: |
            packages/desktop/release/*.AppImage
            packages/desktop/release/*.deb
            packages/desktop/release/*.rpm
            packages/desktop/release/latest-linux.yml

  publish-release:
    needs: [build-mac, build-windows, build-linux]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
          draft: false
          prerelease: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  update-homebrew:
    needs: [publish-release]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: flightdeck-ai/homebrew-flightdeck
          token: ${{ secrets.HOMEBREW_TAP_TOKEN }}

      - name: Update cask version and SHA
        run: |
          VERSION="${GITHUB_REF_NAME#v}"

          # Download release assets to compute SHA256
          curl -sL "https://github.com/flightdeck-ai/flightdeck/releases/download/v${VERSION}/Flightdeck-${VERSION}-mac-universal.dmg" -o dmg
          SHA256=$(shasum -a 256 dmg | cut -d' ' -f1)

          # Update cask file
          sed -i "s/version \".*\"/version \"${VERSION}\"/" Casks/flightdeck.rb
          sed -i "s/sha256 \".*\"/sha256 \"${SHA256}\"/" Casks/flightdeck.rb

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add Casks/flightdeck.rb
          git commit -m "Update flightdeck to ${GITHUB_REF_NAME#v}"
          git push
```

---

## Code Signing Requirements

### macOS: Developer ID Certificate

For direct distribution (non-MAS), you need:

1. **Apple Developer Program** membership ($99/year)
2. **Developer ID Application** certificate (for signing the .app)
3. **Developer ID Installer** certificate (if using .pkg)
4. **App-specific password** for notarization (generated at appleid.apple.com)

Export the certificate as `.p12`, base64-encode it, and store as a GitHub secret:

```bash
# Export certificate from Keychain Access
# Then base64-encode for CI
base64 -i DeveloperID.p12 | pbcopy
# Paste into GitHub secret: MAC_CERTIFICATE_P12_BASE64
```

### Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `MAC_CERTIFICATE_P12_BASE64` | Base64-encoded .p12 certificate |
| `MAC_CERTIFICATE_PASSWORD` | Password for the .p12 file |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `WIN_CERTIFICATE_P12_BASE64` | Windows Authenticode certificate |
| `WIN_CERTIFICATE_PASSWORD` | Password for Windows certificate |
| `HOMEBREW_TAP_TOKEN` | GitHub PAT with repo access to homebrew-flightdeck |

---

## Notarization

Apple requires all distributed macOS apps to be notarized (since Catalina).
electron-builder handles this automatically when the signing environment
variables are set:

```yaml
# electron-builder.yml
mac:
  notarize: true
  # or more explicitly:
  # notarize:
  #   teamId: "ABC123DEF"
```

The notarization process:
1. electron-builder signs the app with Developer ID Application certificate
2. Uploads the signed app to Apple's notarization service
3. Waits for Apple to scan and approve (usually 2-15 minutes)
4. Staples the notarization ticket to the app
5. Result: app opens without Gatekeeper warnings on user machines

---

## Homebrew Cask Auto-Update vs electron-updater

Both mechanisms can coexist:

| Feature | Homebrew Cask | electron-updater |
|---------|-------------|-----------------|
| **Trigger** | `brew upgrade --cask` (manual) | Automatic on app launch |
| **Delta updates** | No (full DMG download) | Yes (blockmap-based) |
| **User effort** | Run brew command | Click "Restart Now" |
| **Rollback** | `brew install --cask flightdeck@0.3.0` | Not built-in |
| **Scope** | macOS only | All platforms |

Recommend: Let electron-updater handle automatic updates. Homebrew is for
initial installation and users who prefer package manager control.

### Disabling electron-updater for Homebrew installs

Some users prefer Homebrew to manage updates. Provide a preference:

```typescript
// In updater.ts
const settings = store.get('settings');
if (settings?.disableAutoUpdate || process.env.HOMEBREW_CELLAR) {
  log.info('Auto-update disabled (user preference or Homebrew install)');
  return;
}
```
