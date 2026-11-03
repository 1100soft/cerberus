# Application icon

The approved mark is the Night watch hound overlapping a shield, with an ice-blue
rim (`#9DE6F2`) and near-black contours (`#100D16`). Preserve the gradients,
overlap and contours at every size; the compact/clipped design studies were not
selected.

`desktop/src-tauri/app-icon.svg` is the editable source of truth. It has a
transparent background and no embedded raster images or external resources.

Run from the repository root after editing the source:

```bash
npm --prefix desktop run icons
```

Regeneration requires the installed Node dependencies and ImageMagick 7 (`magick`).
The Tauri CLI regenerates:

- `desktop/src-tauri/icons/`: standalone PNGs at 16, 24, 32, 48, 64, 128, 256,
  512 and 1024 pixels, plus the default `icon.png` and `128x128@2x.png`.
- Windows ICO and Store assets, macOS ICNS, and Android/iOS assets in their
  existing platform directories. iOS assets use an opaque `#17141F` background. ImageMagick removes their
  alpha channel to meet App Store requirements.
- `desktop/public/app-icon.svg`: browser favicon. The native window/launcher
  keeps the full app icon; the sidebar uses a menu glyph and a subdued decorative
  head instead of repeated app badges.
- `desktop/public/cerberus-head.svg`: monochrome head silhouette derived from the
  source head/eye paths for the sidebar background.
- `website/assets/logo.svg`: website logo and favicon.

The platform icons are generated assets and should be committed with the source.
Do not edit them separately. A packaged app rebuild is needed to update installed
launcher/tray icons; desktop environments may cache old icons until the app or
session is restarted.
