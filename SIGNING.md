# Code signing & notarization (macOS)

The prototype builds an **adhoc-signed** app that runs on the machine that
built it. To distribute to other Macs (avoid Gatekeeper's "unidentified
developer" block), you must sign with a **Developer ID Application**
certificate and **notarize** with Apple.

## 1. Prerequisites

- An Apple Developer Program membership.
- A **Developer ID Application** certificate installed in your login keychain.
- For notarization: an Apple ID + an **app-specific password**
  (https://appleid.apple.com → Sign-In and Security → App-Specific Passwords).

## 2. electron-builder config changes

In `electron-builder.yml`:

1. Remove (or comment out) `identity: null` under `mac:`.
2. Add:

```yaml
mac:
  category: public.app-category.developer-tools
  hardenedRuntime: true
  gatekeeperAssess: false          # we notarize, don't self-assess
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true
```

The bundled `build/entitlements.mac.plist` allows:
- Chromium JIT and executable memory (Electron needs both);
- `disable-library-validation`, so the **sidecar Node** can load the unsigned
  native modules (`node-pty`'s `pty.node`, `sharp`'s libvips, `koffi`, …).

Do **not** add `com.apple.security.app-sandbox` (App Sandbox): it would block
the harness's own subprocess/Seatbelt sandboxing and broad filesystem access.
App Sandbox is only required for the Mac App Store, not for Developer ID
distribution.

## 3. Build

```sh
# Electron's binaries cache + mirror can be overridden if needed:
#   export electron_config_cache="$PWD/.electron-cache"
#   export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

APPLE_ID="you@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="XXXXXXXXXX" \
npx electron-builder --mac
```

electron-builder discovers the signing identity automatically (or set
`CSC_LINK` / `CSC_NAME`). On success it uploads the zip to Apple for
notarization and staples the ticket into the app.

## 4. Verify

```sh
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/DeepSeek Harness.app"
spctl --assess --type execute --verbose=4 "dist/mac-arm64/DeepSeek Harness.app"
xcrun stapler validate "dist/mac-arm64/DeepSeek Harness.app"
```

## Notes / gotchas

- **The sidecar is a separate Node process.** Native modules stay on the Node
  ABI, so nothing is rebuilt for Electron — but every executable in the bundle
  (including `Resources/node/bin/node`) is signed, and the unsigned `.node`
  files are covered by `disable-library-validation`.
- **First Gatekeeper launch** still shows a one-time confirmation unless the
  notarization stapling is complete and the app is served via a downloaded
  (quarantined) copy — that is expected and normal.
- If you change `electronDist` back to auto-download, remember
  `@electron/get` caches to `~/Library/Caches/electron` (override with
  `electron_config_cache`).
