#!/usr/bin/env bash
set -euo pipefail

target="${1:?Usage: install-duckdb.sh TARGET_DIRECTORY}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform="linux-amd64"; checksum="c6507206baf7793c6013dbd82368469a45f20dc0e17a6f92f204602f652ed2bc" ;;
  Darwin-arm64) platform="osx-arm64"; checksum="188a36fe8883ef52e69165a0cbb6031ef679c8e6c448a1ce22951964149b7f96" ;;
  *) echo "Unsupported DuckDB 2.0 validation platform." >&2; exit 1 ;;
esac
mkdir -p "$target"
archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT
curl --fail --location --retry 3 "https://github.com/duckdb/duckdb/releases/download/v2.0.0/duckdb-cli-${platform}.tar.gz" -o "$archive"
actual="$(shasum -a 256 "$archive" | cut -d ' ' -f 1)"
if [ "$actual" != "$checksum" ]; then echo "DuckDB release checksum mismatch." >&2; exit 1; fi
tar -xzf "$archive" -C "$target"
"$target/duckdb" -no-agent --version
