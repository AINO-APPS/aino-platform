#!/usr/bin/env bash
# Reproduce the verification loop's filtering to confirm the skip works and the
# loop still reaches the real assets.
set -euo pipefail

cat <<'HTML' > /tmp/index.html
<link rel="icon" href="/favicon.ico" />
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<script type="module" src="/assets/index-D2E6sji1.js"></script>
<link rel="stylesheet" href="/assets/index-Cna04ZkD.css" />
HTML

grep -oE '(src|href)="/[^"]+"' /tmp/index.html \
  | cut -d'"' -f2 \
  | while read -r ref; do
      key="${ref#/}"
      case "$key" in
        index.html|sw.js|manifest.json) echo "SKIP  $key"; continue ;;
      esac
      echo "CHECK $key"
    done

echo "loop exit status: $?"
