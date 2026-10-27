#!/usr/bin/env bash
# Fails when a Linux binary needs a system Tesseract or Leptonica library.
#
# Tesseract and Leptonica are linked statically on Linux (build-tesseract in
# src-tauri/Cargo.toml). A NEEDED entry such as libtesseract.so.4 means the
# binary only starts where that exact soname is installed, which broke the
# release on distributions that ship Tesseract 5 (#620).
set -euo pipefail

binary=${1:?"usage: linux-ocr-linkage-check.sh <elf-binary>"}

if [[ ! -f "$binary" ]]; then
  echo "binary not found: $binary" >&2
  exit 1
fi

needed=$(readelf -d "$binary" | awk '/\(NEEDED\)/ { gsub(/[][]/, "", $NF); print $NF }')
if [[ -z "$needed" ]]; then
  echo "no NEEDED entries found in $binary (not a dynamic ELF binary?)" >&2
  exit 1
fi

echo "NEEDED entries of $binary:"
printf '  %s\n' $needed

offending=$(printf '%s\n' $needed | grep -E '^(libtesseract|liblept)' || true)
if [[ -n "$offending" ]]; then
  echo "binary dynamically needs system OCR libraries (#620):" >&2
  printf '  %s\n' $offending >&2
  exit 1
fi

echo "OK: no system Tesseract/Leptonica dependency"
