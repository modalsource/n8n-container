#!/usr/bin/env bash
# Gate di scansione Trivy per l'immagine n8n. Uso:
#   ./scripts/scan.sh <immagine[:tag]>            # gate su CRIT/HIGH con fix disponibile
#   IGNORE_UNFIXED=0 ./scripts/scan.sh <img>     # baseline completa (anche senza fix)
#   SBOM=1 ./scripts/scan.sh <img>               # produce anche SBOM CycloneDX
# Exit code: 0 = gate superato, 1 = vulnerabilità sopra soglia, 2 = errore.
set -u

IMAGE=${1:?Uso: scan.sh <immagine[:tag]>}
SEV_GATE=${SEV_GATE:-CRITICAL,HIGH}
IGNORE_UNFIXED=${IGNORE_UNFIXED:-1}
SBOM=${SBOM:-0}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
SCAN_FILE="$OUT/scan-${STAMP}.json"
SBOM_FILE="$OUT/sbom-${STAMP}.cdx.json"

mkdir -p "$OUT"

# DB sempre fresco: una scan con DB vecchio rispetto a una scan di 3 settimane
# prima non è confrontabile.
trivy image --download-db-only >/dev/null 2>&1 || true

ARGS=(image --scanners vuln --severity "$SEV_GATE" --format json --output "$SCAN_FILE")
[ "$IGNORE_UNFIXED" = "1" ] && ARGS+=(--ignore-unfixed)
[ -f "$ROOT/security/vex.openvex.json" ] && ARGS+=(--vex "$ROOT/security/vex.openvex.json")
[ -f "$ROOT/security/trivy-ignore-policy.rego" ] && ARGS+=(--ignore-policy "$ROOT/security/trivy-ignore-policy.rego")

echo ">> Scan $IMAGE (gate: $SEV_GATE, ignore-unfixed: $IGNORE_UNFIXED)"
set +e
trivy "${ARGS[@]}" --exit-code 1 "$IMAGE"
TRIVY_RC=$?
set -e

if [ -f "$SCAN_FILE" ]; then
  node "$ROOT/scripts/summarize.mjs" "$SCAN_FILE" || true
  echo ">> Report JSON: $SCAN_FILE"
fi

if [ "$SBOM" = "1" ]; then
  trivy image --scanners vuln --format cyclonedx --output "$SBOM_FILE" "$IMAGE" >/dev/null 2>&1 || true
  echo ">> SBOM: $SBOM_FILE"
fi

case "$TRIVY_RC" in
  0) echo ">> GATE OK: nessuna $SEV_GATE (con fix) oltre soglia/policy" ;;
  1) echo ">> GATE FALLITO: vulnerabilità $SEV_GATE da fixare o triaggiare (VEX)" ;;
  *) echo ">> ERRORE trivy (rc=$TRIVY_RC)" ;;
esac
exit "$TRIVY_RC"
