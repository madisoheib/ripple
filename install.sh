#!/bin/sh
# Ripple installer — one-liner for any project, Laravel or not:
#   curl -sSL https://raw.githubusercontent.com/madisoheib/ripple/main/install.sh | sh
# Detects OS/arch, downloads the matching static binary from GitHub Releases,
# verifies its SHA-256, installs to ./bin/ripple (or $RIPPLE_INSTALL_DIR).
set -eu

REPO="madisoheib/ripple"
VERSION="${RIPPLE_VERSION:-latest}"
DIR="${RIPPLE_INSTALL_DIR:-./bin}"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux)  os_part="unknown-linux-musl" ;;
  Darwin) os_part="apple-darwin" ;;
  *) echo "Unsupported OS: $os (Windows: download the .exe from https://github.com/$REPO/releases)"; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64)  arch_part="x86_64" ;;
  aarch64|arm64) arch_part="aarch64" ;;
  *) echo "Unsupported architecture: $arch"; exit 1 ;;
esac

asset="ripple-${arch_part}-${os_part}"
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/$VERSION"
fi

echo "Downloading $asset ($VERSION)..."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$asset" "$base/$asset"
curl -fsSL -o "$tmp/$asset.sha256" "$base/$asset.sha256"

echo "Verifying checksum..."
expected=$(awk '{print $1}' "$tmp/$asset.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
else
  actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
fi
[ "$expected" = "$actual" ] || { echo "Checksum mismatch — aborting."; exit 1; }

mkdir -p "$DIR"
mv "$tmp/$asset" "$DIR/ripple"
chmod +x "$DIR/ripple"

echo "Installed: $DIR/ripple"
"$DIR/ripple" --help >/dev/null 2>&1 && echo "OK — run: $DIR/ripple start --config ripple.toml"
