#!/usr/bin/env bash
# Install git-autopush into a user-writable location (default: ~/.local).

set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  if [[ -n "${SUDO_USER:-}" ]]; then
    echo "Please run install.sh as the target user without sudo." >&2
    echo "Specify --prefix if you need a different destination." >&2
  else
    echo "install.sh is intended for per-user installs and should not be run as root." >&2
  fi
  exit 1
fi

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR=""
SHARE_DIR=""
FORCE=false

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--prefix DIR] [--bin-dir DIR] [--share-dir DIR] [--force]

Copies the git-autopush scripts into the share directory and installs the
`autopush` command into the bin directory so it is available on your PATH.
Defaults:
  --prefix     ~/.local
  --bin-dir    <prefix>/bin
  --share-dir  <prefix>/share/autopush

Set PREFIX, BIN_DIR, or SHARE_DIR environment variables to override defaults.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      [[ $# -lt 2 ]] && { echo "Missing value for --prefix" >&2; exit 2; }
      PREFIX="$2"
      shift 2
      ;;
    --bin-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --bin-dir" >&2; exit 2; }
      BIN_DIR="$2"
      shift 2
      ;;
    --share-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --share-dir" >&2; exit 2; }
      SHARE_DIR="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

BIN_DIR="${BIN_DIR:-${PREFIX}/bin}"
SHARE_DIR="${SHARE_DIR:-${PREFIX}/share/autopush}"

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_BIN_DIR="${SCRIPT_ROOT}/bin"
DEST_BIN_DIR="${SHARE_DIR}/bin"
DEST_WRAPPER="${BIN_DIR}/autopush"

mkdir -p "$DEST_BIN_DIR"
cp -a "$SRC_BIN_DIR/." "$DEST_BIN_DIR/"

mkdir -p "$BIN_DIR"
if [[ -e "$DEST_WRAPPER" && "$FORCE" != true ]]; then
  echo "Error: $DEST_WRAPPER already exists. Use --force to overwrite." >&2
  exit 1
fi

cat > "$DEST_WRAPPER" <<EOF
#!/usr/bin/env bash
exec "${DEST_BIN_DIR}/autopush" "\$@"
EOF
chmod +x "$DEST_WRAPPER"

CONFIG_DIR="${AUTOPUSH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/autopush}"
mkdir -p "$CONFIG_DIR"

cat <<SUMMARY
Installed git-autopush into:
  Share dir: $DEST_BIN_DIR
  Command  : $DEST_WRAPPER

Make sure '$BIN_DIR' is on your PATH. Run 'autopush help' to get started.
SUMMARY
