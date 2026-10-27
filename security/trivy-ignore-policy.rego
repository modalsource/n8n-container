# Trivy ignore policy (copia del security/trivy-ignore-policy.rego presente
# nel branch release/2.44.7 di n8n-io/n8n: il toolkit resta autoconsistente
# anche se usi un checkout diverso).
#
# n8n's own published CVEs/GHSAs are intentionally excluded from internal
# scan results. Vulnerabilities in the n8n package should be visible to
# anyone running an older version — they indicate an upgrade is required.
# VEX (vex.openvex.json) covers third-party dependency false positives only.
#
# Per estendere (con prudenza): ogni regola deve avere un commento che indica
# ticket/scadenza. Le regole "for sempre" sono un anti-pattern.
package trivy

import future.keywords.if

default ignore := false

ignore if {
	input.PkgName == "n8n"
}
