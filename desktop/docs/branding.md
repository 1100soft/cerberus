# Application icon

The approved mark is the Night watch hound overlapping a shield, with an ice-blue
rim (`#9DE6F2`) and near-black contours (`#100D16`). Preserve the gradients,
overlap and contours at every size; the compact/clipped design studies were not
selected.

`desktop/src-tauri/app-icon.svg` is the editable source of truth. It has a
transparent background and no embedded raster images or external resources. Its
square viewBox tightly frames the complete stroked silhouette so exports fill
their icon slots without clipping the shield contour or ear tips. The head
gradient runs from `#DFD2FF` to `#927DE9`, with a deeper shield gradient from
`#372756` to `#140E1C` for slightly stronger contrast.

Run from the repository root after editing the source:

```bash
npm --prefix desktop run icons
```

Regeneration requires the installed Node dependencies and ImageMagick 7 (`magick`).
The Tauri CLI regenerates:

- `desktop/src-tauri/icons/`: standalone PNGs at 16, 24, 32, 48, 64, 128, 256,
  512 and 1024 pixels, plus the default `icon.png` and `128x128@2x.png`.
- Windows ICO and Store assets, macOS ICNS, and Android/iOS assets in their
  existing platform directories. Android uses a `#17141F` launcher background.
  iOS assets use the same opaque background; ImageMagick removes their alpha
  channel to meet App Store requirements and strips timestamp metadata so the
  exports remain reproducible.
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

The sidebar head renders at a fixed 280 CSS pixels, centered at 65% of the sidebar
height. Its placement is independent of page content. The shared sidebar uses
250px on larger windows and 192px at widths up to 1100px, with the same width and
padding across every page at a given window size.
