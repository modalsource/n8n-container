'use strict';

// The SuiteCRM node only requires `n8n-workflow` at runtime. Its package.json
// still declares `n8n-core ~0.111.0`, which would drag in an unmaintained copy
// of n8n with fixable CRITICAL/HIGH CVEs. If some code path ever requires this
// package, fail loudly instead of silently loading a second n8n core.
throw new Error(
	'n8n-core is stubbed in the n8n custom-nodes image: the real package is not installed here',
);
