/**
 * Dev environment smoke checks.
 * Hits API endpoints and verifies expected state from seed data.
 *
 * Usage: npx tsx .claude/skills/dev-environment/check.ts
 *
 * Expects the dev app to be running on localhost:3001
 */

const BASE_URL = 'http://localhost:3001';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function checkProposedRules(): Promise<CheckResult> {
  try {
    const data = (await fetchJson('/api/proposed-rules')) as unknown[];
    const count = Array.isArray(data) ? data.length : 0;
    return {
      name: 'Proposed rules exist',
      passed: count >= 2,
      detail: `Found ${count} proposed rules (expected >= 2)`,
    };
  } catch (err) {
    return { name: 'Proposed rules exist', passed: false, detail: String(err) };
  }
}

async function checkActivity(): Promise<CheckResult> {
  try {
    const data = (await fetchJson('/api/activity')) as unknown[];
    const count = Array.isArray(data) ? data.length : 0;
    return {
      name: 'Activity entries exist',
      passed: count >= 3,
      detail: `Found ${count} activity entries (expected >= 3)`,
    };
  } catch (err) {
    return { name: 'Activity entries exist', passed: false, detail: String(err) };
  }
}

async function checkStatus(): Promise<CheckResult> {
  try {
    const data = (await fetchJson('/api/status')) as Record<string, unknown>;
    return {
      name: 'App status endpoint responds',
      passed: true,
      detail: `Status: ${JSON.stringify(data).slice(0, 100)}...`,
    };
  } catch (err) {
    return { name: 'App status endpoint responds', passed: false, detail: String(err) };
  }
}

async function checkRules(): Promise<CheckResult> {
  try {
    const data = (await fetchJson('/api/rules')) as unknown[];
    const count = Array.isArray(data) ? data.length : 0;
    return {
      name: 'Rules configured',
      passed: count >= 2,
      detail: `Found ${count} rules (expected >= 2)`,
    };
  } catch (err) {
    return { name: 'Rules configured', passed: false, detail: String(err) };
  }
}

async function checkFrontend(): Promise<CheckResult> {
  try {
    const res = await fetch(BASE_URL);
    const ok = res.ok && res.headers.get('content-type')?.includes('text/html');
    return {
      name: 'Frontend loads',
      passed: ok ?? false,
      detail: ok ? 'HTML served successfully' : `Status ${res.status}`,
    };
  } catch (err) {
    return { name: 'Frontend loads', passed: false, detail: String(err) };
  }
}

async function main(): Promise<void> {
  console.log('Running dev environment checks against', BASE_URL);
  console.log('');

  const checks = [
    checkFrontend,
    checkStatus,
    checkRules,
    checkActivity,
    checkProposedRules,
  ];

  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await check();
    results.push(result);
    const icon = result.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${result.name}`);
    console.log(`         ${result.detail}`);
  }

  console.log('');
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`${passed}/${total} checks passed`);

  if (passed < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});
