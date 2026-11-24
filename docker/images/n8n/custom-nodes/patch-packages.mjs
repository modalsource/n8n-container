// Build-time fixes for the pre-installed community nodes.
//
// Two upstream packages ship manifests/code that do not match what n8n 2.x
// expects. The versions are pinned and the lockfile is committed, so these
// patches are deterministic. Both steps fail the image build if the target is
// not found, instead of shipping a node that silently does not load.

import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const nodeModules = path.join(root, 'node_modules');

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

/** Every installed package.json, including scoped packages. */
async function packageManifests() {
	const manifests = [];
	for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		if (entry.name.startsWith('@')) {
			for (const child of await readdir(path.join(nodeModules, entry.name), { withFileTypes: true })) {
				if (child.isDirectory()) {
					manifests.push(path.join(nodeModules, entry.name, child.name, 'package.json'));
				}
			}
		} else {
			manifests.push(path.join(nodeModules, entry.name, 'package.json'));
		}
	}
	return manifests;
}

// n8n's CustomDirectoryLoader checks access() on the exact paths listed in the
// `n8n` field. @digital-boss/n8n-nodes-billrun-suitecrm lists
// "dist/credentials/SuiteCrmApi.credentials" while the shipped file is
// "...credentials.js", so n8n 2.x skips the whole package. Add the extension
// when the .js file is the one that exists.
async function normalizeManifests() {
	for (const manifest of await packageManifests()) {
		if (!(await exists(manifest))) continue;
		const pkg = JSON.parse(await readFile(manifest, 'utf8'));
		if (!pkg.n8n) continue;

		const dir = path.dirname(manifest);
		let changed = false;
		for (const kind of ['nodes', 'credentials']) {
			const entries = pkg.n8n[kind] ?? [];
			pkg.n8n[kind] = [];
			for (const entry of entries) {
				let target = entry;
				if (!(await exists(path.join(dir, target))) && (await exists(path.join(dir, `${target}.js`)))) {
					target = `${target}.js`;
					changed = true;
				}
				// Fail the build if, after normalization, the manifest still points
				// at something that is not there.
				if (!(await exists(path.join(dir, target)))) {
					throw new Error(`${pkg.name}: n8n.${kind} entry not found: ${entry}`);
				}
				pkg.n8n[kind].push(target);
			}
		}

		if (changed) {
			await writeFile(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
			console.log(`patched manifest paths in ${pkg.name}`);
		}
	}
}

// n8n-nodes-pdfkit calls image-size as a callable CommonJS default. With
// image-size 2.x (CVE-2025-71329/71330 fixed) the export is
// `{ imageSize }`, so adapt that one require.
async function patchPdfKit() {
	const file = path.join(
		nodeModules,
		'n8n-nodes-pdfkit',
		'dist',
		'nodes',
		'PdfKit',
		'PdfKit.node.js',
	);
	const original = "var sizeOf = require('image-size');";
	const patched = "var { imageSize: sizeOf } = require('image-size');";

	const source = await readFile(file, 'utf8');
	if (source.includes(patched)) {
		console.log('n8n-nodes-pdfkit image-size require already patched');
		return;
	}
	if (!source.includes(original)) {
		throw new Error(`${file}: expected "${original}" not found; the package changed`);
	}
	await writeFile(file, source.replace(original, patched));
	console.log('patched n8n-nodes-pdfkit image-size require');
}

await normalizeManifests();
await patchPdfKit();
