// tests/resolve-provider-skip-explicit.test.mjs — a provider id in `skipIds` is
// skipped even when the entry names it in an explicit `provider:` field.
//
// `skipIds: ['local-parser']` is how verify-portals.mjs and audit-portals.mjs
// stay network-only: local-parser's fetch() executes the command configured in
// portals.yml, and a health check must not do that. resolveProvider() honored
// the list for an entry that reaches local-parser through detect() (it has
// `parser.command` + `parser.script` and no `provider:` field), but returned an
// explicit `provider: local-parser` before looking at the list, so the same
// entry written with the field was executed by both checks.
//
// The third caller is scan.mjs's fallback: when a local parser fails it resolves
// the entry again with local-parser skipped, to find an API provider to fall
// back to. For the explicit form that returned local-parser itself, and the
// failed command ran a second time.
//
// Offline: stub providers, and the local-parser stand-in only counts its calls.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nresolveProvider — skipIds also covers an explicit provider: field');

try {
  const load = (file) => import(pathToFileURL(join(ROOT, file)).href);
  const { resolveProvider } = await load('providers/_registry.mjs');
  const { verifyCompanies } = await load('verify-portals.mjs');
  const { auditCompanies } = await load('audit-portals.mjs');

  let parserRuns = 0;
  const localParser = {
    id: 'local-parser',
    detect: (e) => (e.parser?.command ? { url: e.careers_url } : null),
    fetch: async () => { parserRuns++; return [{ title: 'Role', url: 'https://self-hosted.example.com/j/1' }]; },
  };
  const board = {
    id: 'board',
    detect: (e) => (String(e.careers_url || '').includes('board.example.com') ? { url: e.careers_url } : null),
    fetch: async () => [{ title: 'Role', url: 'https://board.example.com/j/1' }],
  };
  const reg = new Map([['board', board], ['local-parser', localParser]]);
  const skip = { skipIds: ['local-parser'] };

  const parser = { command: 'node', script: 'local/jobs.mjs' };
  const explicit = { name: 'Explicit Co', careers_url: 'https://self-hosted.example.com/careers', provider: 'local-parser', parser };
  const detected = { name: 'Detected Co', careers_url: 'https://self-hosted.example.com/careers', parser };
  const explicitOnBoard = { ...explicit, name: 'Board Co', careers_url: 'https://board.example.com/acme' };

  // ── resolveProvider ──
  // Control first: without skipIds the explicit field must still win, or the
  // assertions below would pass on a registry that never resolves it at all.
  const plain = resolveProvider(explicit, reg);
  if (plain?.provider?.id === 'local-parser') pass('without skipIds, an explicit provider: local-parser still resolves to it');
  else fail(`explicit provider no longer resolves: ${JSON.stringify(plain)}`);

  const skipped = resolveProvider(explicit, reg, skip);
  if (skipped === null) pass('with local-parser skipped, an explicit provider: local-parser does not resolve to it');
  else fail(`skipIds did not cover the explicit field: resolved to ${skipped?.provider?.id ?? JSON.stringify(skipped)}`);

  // The two spellings of one entry must resolve alike under the same skip list.
  const viaDetect = resolveProvider(detected, reg, skip);
  if (viaDetect === skipped) pass('the explicit and the detected form of one entry resolve the same way');
  else fail(`the two forms diverge: detected=${JSON.stringify(viaDetect)} explicit=${JSON.stringify(skipped)}`);

  // What scan.mjs's fallback asks for: the next provider that claims the entry.
  const fallback = resolveProvider(explicitOnBoard, reg, skip);
  if (fallback?.provider?.id === 'board') pass('with local-parser skipped, the entry falls through to the provider that detects it');
  else fail(`no fallback provider for a skipped explicit entry: ${JSON.stringify(fallback)}`);

  // A typo is still reported as a typo; skipping one id must not swallow it.
  const typo = resolveProvider({ ...explicit, provider: 'local-praser' }, reg, skip);
  if (/local-praser/.test(typo?.error || '')) pass('an unknown explicit provider is still an error under skipIds');
  else fail(`unknown-provider error lost: ${JSON.stringify(typo)}`);

  // ── the two health checks, through their real entry points ──
  const deny = async () => { throw new Error('network is not allowed in this test'); };
  const httpCtx = { fetchJson: deny, fetchText: deny };

  parserRuns = 0;
  const verifyRows = await verifyCompanies([explicit], { providers: reg, httpCtx });
  if (parserRuns === 0 && verifyRows.length === 1 && verifyRows[0].status === 'skipped') {
    pass('verify-portals does not execute an explicit local-parser entry');
  } else {
    fail(`verify-portals ran the local parser ${parserRuns} time(s): ${JSON.stringify(verifyRows)}`);
  }

  parserRuns = 0;
  const auditRows = await auditCompanies([explicit], { providers: reg, httpCtx });
  if (parserRuns === 0 && auditRows.length === 1 && auditRows[0].provider !== 'local-parser') {
    pass('audit-portals does not execute an explicit local-parser entry');
  } else {
    fail(`audit-portals ran the local parser ${parserRuns} time(s): ${JSON.stringify(auditRows)}`);
  }
} catch (err) {
  fail(`resolveProvider skipIds tests could not run: ${err.message}`);
}
