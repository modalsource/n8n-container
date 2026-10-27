#!/usr/bin/env node
/**
 * Riepilogo di un report Trivy JSON, senza dipendenze.
 * Uso: node scripts/summarize.mjs <report.json>
 * Stampa: totale, severità, fixable/unfixed, ripartizione per target,
 * top pacchetti CRIT/HIGH e lista CRIT/HIGH con fix.
 */
import fs from 'node:fs';

const [, , file] = process.argv;
if (!file) {
	console.error('Uso: node summarize.mjs <trivy.json>');
	process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const all = data.Results?.flatMap((r) => r.Vulnerabilities ?? []) ?? [];
if (all.length === 0) {
	console.log('Nessuna vulnerabilità.');
	process.exit(0);
}

const sev = (xs) => {
	const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
	for (const v of xs) c[v.Severity in c ? v.Severity : 'UNKNOWN']++;
	return `CRIT=${c.CRITICAL} HIGH=${c.HIGH} MED=${c.MEDIUM} LOW=${c.LOW}`;
};
const fixable = all.filter((v) => v.FixedVersion);
const unfixed = all.filter((v) => !v.FixedVersion);

console.log(`TOTALE: ${all.length} | ${sev(all)}`);
console.log(`Con fix disponibile: ${fixable.length} (${sev(fixable)})`);
console.log(`Senza fix: ${unfixed.length} (${sev(unfixed)})`);

console.log('\nPer target:');
for (const r of data.Results ?? []) {
	console.log(`  ${r.Target} [${r.Class ?? '?'}]: ${r.Vulnerabilities?.length ?? 0} — ${sev(r.Vulnerabilities ?? [])}`);
}

const critHigh = all.filter((v) => v.Severity === 'CRITICAL' || v.Severity === 'HIGH');
if (critHigh.length > 0) {
	console.log('\nTop pacchetti (CRIT/HIGH):');
	const byPkg = new Map();
	for (const v of critHigh) byPkg.set(v.PkgName, (byPkg.get(v.PkgName) ?? 0) + 1);
	for (const [pkg, n] of [...byPkg.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pkg}: ${n}`);

	console.log('\nCRITICAL/HIGH (ordine severità, pacchetto):');
	for (const v of critHigh.sort((a, b) => a.PkgName.localeCompare(b.PkgName) || a.Severity.localeCompare(b.Severity))) {
		console.log(`  [${v.Severity}] ${v.VulnerabilityID}  ${v.PkgName} ${v.InstalledVersion} -> fix: ${v.FixedVersion ?? 'NESSUN FIX'}`);
	}
}
