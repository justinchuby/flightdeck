# Cross-Platform Builds — Flightdeck Desktop

## Overview

Flightdeck Desktop is built for three platforms using electron-builder with a
GitHub Actions CI/CD matrix. Each platform has specific code signing, packaging,
and distribution requirements.

| Platform | Targets | Code Signing | Store |
|----------|---------|-------------|-------|
| **macOS** | DMG (universal), ZIP, MAS (pkg) | Developer ID + Notarization | Mac App Store (optional) |
| **Windows** | NSIS installer, portable ZIP | Authenticode (EV or OV) | Microsoft Store (optional) |
| **Linux** | AppImage, deb, rpm | None required | Snap Store (optional) |

---

## electron-builder Configuration

```yaml
# packages/desktop/electron-builder.yml
appId: com.flightdeck.app
productName: Flightdeck
copyright: "Copyright © 2026 Flightdeck Contributors"

# ── Directories ────────────────────────────────────────────────
directories:
  buildResources: build        # Icons, entitlements, background images
  output: release              # Build artifacts go here

# ── File Selection ─────────────────────────────────────────────
files:
  - "dist/**/*"                # Compiled TypeScript
  - "node_modules/**/*"        # Runtime dependencies
  # Exclude build artifacts and source maps
  - "!node_modules/**/build/Release/.deps"
  - "!node_modules/**/build/Release/obj*"
  - "!node_modules/**/*.map"
  - "!node_modules/**/*.ts"
  - "!node_modules/**/test/**"
  - "!node_modules/**/tests/**"
  - "!node_modules/**/docs/**"
  - "!node_modules/**/.github/**"

# ── Extra Resources (outside ASAR, accessible at runtime) ──────
extraResources:
  - from: "../server/dist"
    to: "server"
    filter: ["**/*"]
  - from: "../server/drizzle"
    to: "drizzle"
    filter: ["**/*"]
  - from: "../web/dist"
    to: "web"
    filter: ["**/*"]
  - from: "../shared/dist"
    to: "shared"
    filter: ["**/*"]

# ── ASAR Packaging ─────────────────────────────────────────────
asar: true
asarUnpack:
  - "**/*.node"                # Native modules must be unpacked
  - "**/better-sqlite3/**"     # SQLite native addon
  - "**/drizzle/**"            # Migration SQL files

# ── Publish (auto-update feed) ─────────────────────────────────
publish:
  provider: github
  owner: flightdeck-ai
  repo: flightdeck
  releaseType: release

# ══════════════════════════════════════════════════════════════
# macOS Configuration
# ══════════════════════════════════════════════════════════════

mac:
  category: public.app-category.developer-tools
  icon: build/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  darkModeSupport: true
  artifactName: "Flightdeck-${version}-mac-${arch}.${ext}"

  # Code signing
  identity: "Developer ID Application: Flightdeck Inc (TEAMID)"
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist

  # Notarization (requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID env)
  notarize: true

  target:
    # Universal binary (arm64 + x64 in one binary)
    - target: dmg
      arch: [universal]
    # ZIP for auto-updater (Squirrel.Mac needs zip)
    - target: zip
      arch: [universal]

# DMG customization
dmg:
  background: build/dmg-background.png
  iconSize: 80
  window:
    width: 600
    height: 400
  contents:
    - x: 170
      y: 200
    - x: 430
      y: 200
      type: link
      path: /Applications

# MAS (Mac App Store) — separate target, different signing
mas:
  category: public.app-category.developer-tools
  entitlements: build/entitlements.mas.plist
  entitlementsInherit: build/entitlements.mas.inherit.plist
  provisioningProfile: build/embedded.provisionprofile
  artifactName: "Flightdeck-${version}-mas.${ext}"
  # MAS uses a different signing identity
  identity: "Apple Distribution: Flightdeck Inc (TEAMID)"

# ══════════════════════════════════════════════════════════════
# Windows Configuration
# ══════════════════════════════════════════════════════════════

win:
  icon: build/icon.ico
  artifactName: "Flightdeck-${version}-win-${arch}.${ext}"

  # Code signing (requires WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD env)
  sign: true
  signingHashAlgorithms: [sha256]

  # Certificate subject name (for EV certificates)
  # certificateSubjectName: "Flightdeck Inc"

  target:
    - target: nsis
      arch: [x64, arm64]

# NSIS installer options
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false              # Install per-user by default
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Flightdeck
  uninstallDisplayName: Flightdeck
  menuCategory: Development
  license: ../../LICENSE
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico

  # File associations
  # fileAssociations:
  #   - ext: flightdeck
  #     name: Flightdeck Project
  #     role: Editor

# ══════════════════════════════════════════════════════════════
# Linux Configuration
# ══════════════════════════════════════════════════════════════

linux:
  icon: build/icon.png
  category: Development
  maintainer: "Flightdeck <hello@flightdeck.ai>"
  vendor: "Flightdeck"
  synopsis: "Multi-agent AI orchestration platform"
  description: >
    Flightdeck is a desktop application for orchestrating multiple AI coding
    agents. It manages agent lifecycles, coordinates tasks via DAGs, and
    provides real-time monitoring of agent activity.
  artifactName: "Flightdeck-${version}-linux-${arch}.${ext}"

  target:
    - target: AppImage
      arch: [x64, arm64]
    - target: deb
      arch: [x64, arm64]
    - target: rpm
      arch: [x64]

  desktop:
    Name: Flightdeck
    GenericName: AI Agent Orchestrator
    Comment: Multi-agent AI orchestration platform
    Type: Application
    Categories: Development;IDE;
    StartupNotify: "true"
    Terminal: "false"
    MimeType: x-scheme-handler/flightdeck;
    Keywords: AI;agent;copilot;coding;development;

# AppImage options
appImage:
  artifactName: "Flightdeck-${version}-${arch}.AppImage"

# Debian package options
deb:
  depends:
    - libnotify4
    - libxtst6
    - libnss3
  afterInstall: build/linux/after-install.sh
  afterRemove: build/linux/after-remove.sh

# RPM package options
rpm:
  depends:
    - libnotify
    - libXtst
    - nss
```

---

## Code Signing Details

### macOS Code Signing

#### Certificates Required

| Certificate | Usage | Where to Get |
|------------|-------|-------------|
| **Developer ID Application** | Sign .app for direct distribution | Apple Developer Portal → Certificates |
| **Developer ID Installer** | Sign .pkg installers | Apple Developer Portal → Certificates |
| **Apple Distribution** | Sign .app for Mac App Store | Apple Developer Portal → Certificates |
| **Mac Installer Distribution** | Sign .pkg for Mac App Store | Apple Developer Portal → Certificates |

#### Certificate Setup for CI

```bash
# 1. Export certificate from Keychain Access as .p12
# 2. Base64-encode for storage as GitHub secret
base64 -i "DeveloperIDApplication.p12" -o cert.b64

# 3. Store in GitHub secrets:
#    MAC_CERTIFICATE_P12_BASE64 = contents of cert.b64
#    MAC_CERTIFICATE_PASSWORD   = the .p12 export password
```

#### Notarization Setup

```bash
# 1. Generate app-specific password at https://appleid.apple.com
# 2. Store in GitHub secrets:
#    APPLE_ID                     = your-apple-id@example.com
#    APPLE_APP_SPECIFIC_PASSWORD  = xxxx-xxxx-xxxx-xxxx
#    APPLE_TEAM_ID                = ABCDE12345
```

#### Verification

```bash
# After building, verify the signature:
codesign --verify --deep --strict "Flightdeck.app"

# Verify notarization:
spctl --assess --type execute --verbose=4 "Flightdeck.app"

# Check entitlements:
codesign --display --entitlements :- "Flightdeck.app"
```

### Windows Code Signing

#### Certificate Options

| Type | Cost | Trust Level | CI Requirement |
|------|------|------------|---------------|
| **OV (Organization Validation)** | $200-400/year | Medium — SmartScreen warning for first ~days | .p12 file + password |
| **EV (Extended Validation)** | $300-600/year | High — no SmartScreen warning | Hardware token (USB) OR cloud-based signing service |

**Recommendation**: Start with OV for simplicity (works in CI without hardware).
Upgrade to EV once download volume justifies the cost.

#### CI Setup for OV Certificate

```bash
# Store in GitHub secrets:
#   WIN_CERTIFICATE_P12_BASE64 = base64-encoded .pfx/.p12 file
#   WIN_CERTIFICATE_PASSWORD   = the .p12 export password
```

#### CI Setup for EV Certificate (Cloud-Based)

EV certificates require hardware tokens. For CI, use a cloud signing service
like **Azure Trusted Signing**, **DigiCert KeyLocker**, or **SSL.com eSigner**:

```yaml
# Example with Azure Trusted Signing
- name: Sign Windows app
  uses: azure/trusted-signing-action@v0.5.0
  with:
    azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
    azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
    endpoint: https://eus.codesigning.azure.net/
    trusted-signing-account-name: flightdeck
    certificate-profile-name: flightdeck-ev
    files-folder: packages/desktop/release
    files-folder-filter: exe
```

### Linux: No Code Signing Required

Linux packages (AppImage, deb, rpm) do not require code signing. Users may
verify GPG signatures if you choose to sign release artifacts:

```bash
# Optional: GPG sign the release
gpg --detach-sign --armor Flightdeck-0.4.0-x86_64.AppImage
```

---

## CI/CD Build Matrix

### Full Release Workflow

```yaml
# .github/workflows/desktop-release.yml
name: Desktop Release

on:
  push:
    tags: ['v*']

# Required for creating releases
permissions:
  contents: write

env:
  NODE_VERSION: '20'

jobs:
  # ── Build macOS ──────────────────────────────────────────────
  build-mac:
    runs-on: macos-14  # Apple Silicon runner (arm64)
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build monorepo
        run: npm run build

      - name: Rebuild native modules for Electron
        working-directory: packages/desktop
        run: npx @electron/rebuild -f -w better-sqlite3

      - name: Build Electron app (macOS universal)
        working-directory: packages/desktop
        run: npx electron-builder --mac --universal
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.MAC_CERTIFICATE_P12_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-mac
          path: |
            packages/desktop/release/*.dmg
            packages/desktop/release/*.zip
            packages/desktop/release/*.blockmap
            packages/desktop/release/latest-mac.yml
          retention-days: 7

  # ── Build macOS MAS (Mac App Store) ──────────────────────────
  build-mas:
    runs-on: macos-14
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build monorepo
        run: npm run build

      - name: Rebuild native modules for Electron
        working-directory: packages/desktop
        run: npx @electron/rebuild -f -w better-sqlite3

      - name: Import provisioning profile
        run: |
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          echo "${{ secrets.MAS_PROVISIONING_PROFILE_BASE64 }}" | base64 -d > ~/Library/MobileDevice/Provisioning\ Profiles/embedded.provisionprofile
          cp ~/Library/MobileDevice/Provisioning\ Profiles/embedded.provisionprofile packages/desktop/build/embedded.provisionprofile

      - name: Build Electron app (MAS)
        working-directory: packages/desktop
        run: npx electron-builder --mac --target mas
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.MAS_CERTIFICATE_P12_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAS_CERTIFICATE_PASSWORD }}

      - name: Upload to App Store Connect
        run: |
          xcrun altool --upload-app \
            --file packages/desktop/release/*.pkg \
            --type macos \
            --apiKey ${{ secrets.APP_STORE_API_KEY_ID }} \
            --apiIssuer ${{ secrets.APP_STORE_API_ISSUER }}

  # ── Build Windows ────────────────────────────────────────────
  build-win:
    runs-on: windows-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build monorepo
        run: npm run build

      - name: Rebuild native modules for Electron
        working-directory: packages/desktop
        run: npx @electron/rebuild -f -w better-sqlite3

      - name: Build Electron app (Windows x64 + arm64)
        working-directory: packages/desktop
        run: npx electron-builder --win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WIN_CSC_LINK: ${{ secrets.WIN_CERTIFICATE_P12_BASE64 }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERTIFICATE_PASSWORD }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-win
          path: |
            packages/desktop/release/*.exe
            packages/desktop/release/*.exe.blockmap
            packages/desktop/release/latest.yml
          retention-days: 7

  # ── Build Linux ──────────────────────────────────────────────
  build-linux:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build monorepo
        run: npm run build

      - name: Rebuild native modules for Electron
        working-directory: packages/desktop
        run: npx @electron/rebuild -f -w better-sqlite3

      - name: Build Electron app (Linux)
        working-directory: packages/desktop
        run: npx electron-builder --linux
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-linux
          path: |
            packages/desktop/release/*.AppImage
            packages/desktop/release/*.deb
            packages/desktop/release/*.rpm
            packages/desktop/release/latest-linux.yml
          retention-days: 7

  # ── Publish GitHub Release ───────────────────────────────────
  publish:
    needs: [build-mac, build-win, build-linux]
    runs-on: ubuntu-latest

    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref, '-beta') || contains(github.ref, '-rc') }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Native Module Cross-Compilation

### The Problem

`better-sqlite3` contains C++ code compiled to a `.node` binary. This binary is
platform AND architecture-specific. You cannot build a macOS arm64 `.node` file
on a Linux x86_64 CI runner.

### The Solution

**Build on each platform natively.** The CI matrix runs each platform build on
its native runner:

| Runner | Platform | Architecture |
|--------|---------|-------------|
| `macos-14` | macOS | arm64 (Apple Silicon) |
| `windows-latest` | Windows | x64 |
| `ubuntu-latest` | Linux | x64 |

For macOS universal builds (arm64 + x64 in one binary), electron-builder handles
this automatically on Apple Silicon runners by building both architectures and
using `lipo` to merge them.

For Windows arm64, electron-builder cross-compiles from x64 (supported since
electron-builder v25).

---

## Build Artifacts

### What Gets Built Per Release

```
release/
├── macOS
│   ├── Flightdeck-0.4.0-mac-universal.dmg           # Drag-to-install
│   ├── Flightdeck-0.4.0-mac-universal.dmg.blockmap  # Delta update data
│   ├── Flightdeck-0.4.0-mac-universal.zip           # For auto-updater
│   ├── Flightdeck-0.4.0-mac-universal.zip.blockmap
│   ├── Flightdeck-0.4.0-mas.pkg                     # Mac App Store
│   └── latest-mac.yml                                # Update manifest
│
├── Windows
│   ├── Flightdeck-0.4.0-win-x64.exe                 # NSIS installer
│   ├── Flightdeck-0.4.0-win-x64.exe.blockmap
│   ├── Flightdeck-0.4.0-win-arm64.exe               # ARM64 installer
│   ├── Flightdeck-0.4.0-win-arm64.exe.blockmap
│   └── latest.yml                                     # Update manifest
│
└── Linux
    ├── Flightdeck-0.4.0-x86_64.AppImage              # Universal Linux
    ├── Flightdeck-0.4.0-amd64.deb                    # Debian/Ubuntu
    ├── Flightdeck-0.4.0-x86_64.rpm                   # Fedora/RHEL
    └── latest-linux.yml                               # Update manifest
```

---

## Platform-Specific Distribution Channels

### Windows: winget

Submit a manifest to the `microsoft/winget-pkgs` repository:

```yaml
# manifests/f/FlightdeckAI/Flightdeck/0.4.0/FlightdeckAI.Flightdeck.yaml
PackageIdentifier: FlightdeckAI.Flightdeck
PackageVersion: 0.4.0
PackageName: Flightdeck
Publisher: Flightdeck AI
License: MIT
ShortDescription: Multi-agent AI orchestration platform
InstallerType: nsis
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/flightdeck-ai/flightdeck/releases/download/v0.4.0/Flightdeck-0.4.0-win-x64.exe
    InstallerSha256: PLACEHOLDER
  - Architecture: arm64
    InstallerUrl: https://github.com/flightdeck-ai/flightdeck/releases/download/v0.4.0/Flightdeck-0.4.0-win-arm64.exe
    InstallerSha256: PLACEHOLDER
ManifestType: singleton
ManifestVersion: 1.6.0
```

```bash
# Users install with:
winget install FlightdeckAI.Flightdeck
```

### Linux: Snap Store

```yaml
# snap/snapcraft.yaml
name: flightdeck
version: '0.4.0'
summary: Multi-agent AI orchestration platform
description: |
  Flightdeck manages multiple AI coding agents, coordinating tasks
  via DAGs with real-time monitoring.
base: core22
grade: stable
confinement: classic   # Developer tools need classic (full system access)
architectures:
  - build-on: amd64

apps:
  flightdeck:
    command: flightdeck
    extensions: [gnome]

parts:
  flightdeck:
    plugin: dump
    source: Flightdeck-0.4.0-x86_64.AppImage
    source-type: file
```

### Linux: Post-Install Scripts

```bash
# build/linux/after-install.sh
#!/bin/bash
# Register desktop file and MIME type
update-desktop-database /usr/share/applications || true
update-mime-database /usr/share/mime || true

# Register protocol handler
xdg-mime default flightdeck.desktop x-scheme-handler/flightdeck || true
```

```bash
# build/linux/after-remove.sh
#!/bin/bash
update-desktop-database /usr/share/applications || true
update-mime-database /usr/share/mime || true
```

---

## Icon Requirements

### macOS (.icns)

Sizes needed: 16, 32, 64, 128, 256, 512, 1024 pixels (all @1x and @2x)

```bash
# Generate from 1024x1024 PNG source
mkdir icon.iconset
sips -z 16 16     icon-1024.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon-1024.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon-1024.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon-1024.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon-1024.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon-1024.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon-1024.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon-1024.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon-1024.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon-1024.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build/icon.icns
```

### Windows (.ico)

Sizes: 16, 24, 32, 48, 64, 128, 256 pixels

```bash
# Using ImageMagick
convert icon-1024.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
```

### Linux (.png)

Single 512x512 PNG. electron-builder handles the rest.
