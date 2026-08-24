#!/usr/bin/env node

/**
 * Mock Removal Tester
 * 
 * Automatically tests if certain mocked modules in `frappe_mocks.py` are actually
 * required by the browser runtime. It does this by temporarily removing the mock,
 * triggering a frontend build, and running the Playwright test suite.
 * 
 * If the suite passes without the mock, it can safely be deleted!
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const MOCKS_FILE = resolve(ROOT_DIR, 'runtime/python/frappe_mocks.py');
const REPORT_OUTPUT_DIR = resolve(ROOT_DIR, 'artifacts/ablation');

// List of mocks we suspect are dead code and should be tested for removal.
const targets = [
  { id: 'psycopg2', type: 'block', reason: 'Postgres adapter, but we use SQLite' },
  { id: 'pwd_grp', type: 'block', reason: 'Unix user checks not used in Pyodide' },
  { id: 'twilio', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'boto3', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'botocore', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'dropbox', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'braintree', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'stripe', type: 'list', reason: 'Not imported directly by Frappe core' },
  { id: 'plaid', type: 'list', reason: 'Only an ERPNext dependency, not Frappe' },
  { id: 'sentry_sdk', type: 'list', reason: 'Shadows actual sentry-sdk package' },
  { id: 'posthog', type: 'list', reason: 'Telemetry moved to pulse in v16.30.0' }
];

// Helpers to temporarily strip the mock from the python file
const stripMock = (content, target) => {
  if (target.type === 'block') {
    const blockRegex = new RegExp(`# >>> mock-test-target: ${target.id}\\n[\\s\\S]*?# <<< mock-test-target: ${target.id}\\n?`, 'm');
    if (!blockRegex.test(content)) throw new Error(`Could not find block for ${target.id}`);
    return content.replace(blockRegex, `# (removed ${target.id})\n`);
  } else {
    const listRegex = new RegExp(`^\\s*"${target.id}",\\n`, 'm');
    if (!listRegex.test(content)) throw new Error(`Could not find list entry for ${target.id}`);
    return content.replace(listRegex, '');
  }
};

const execute = (cmd) => {
  return new Promise((resolve) => {
    const proc = spawn(cmd, { cwd: ROOT_DIR, shell: true });
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
      process.stderr.write(data);
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        const snippet = output.split('\n').slice(-40).join('\n') || `Exited with code ${code}`;
        resolve({ success: false, error: snippet });
      }
    });
  });
};

// CLI Parsing
const userArgs = process.argv.slice(2);
if (userArgs.includes('--list')) {
  console.log('Available mocks for removal testing:\n');
  targets.forEach(t => console.log(`  - ${t.id.padEnd(15)} : ${t.reason}`));
  process.exit(0);
}

const mocksToTest = userArgs.length 
  ? targets.filter(t => userArgs.includes(t.id))
  : targets;

if (userArgs.length && mocksToTest.length !== userArgs.length) {
  console.error('Error: One or more provided mock IDs are invalid.');
  process.exit(1);
}

console.log(`Starting mock removal test for ${mocksToTest.length} item(s)...`);
console.log('Note: Ensure your base test suite is passing before running this!\n');

const originalContent = readFileSync(MOCKS_FILE, 'utf-8');
let restoreNeeded = false;

// Ensure we restore the file if the user Ctrl+C's mid-run
process.on('SIGINT', () => {
  if (restoreNeeded) {
    writeFileSync(MOCKS_FILE, originalContent);
    console.log('\n[SIGINT] Restored frappe_mocks.py to original state.');
  }
  process.exit(130);
});

const reportData = [];

try {
  restoreNeeded = true;
  for (const target of mocksToTest) {
    process.stdout.write(`Testing removal of '${target.id}'... `);
    
    // 1. Remove the mock
    writeFileSync(MOCKS_FILE, stripMock(originalContent, target));

    // 2. Build the browser bundle
    console.log('\n    --- [Phase: Build] ---');
    let step = await execute('npm run build');
    let phase = 'build';

    // 3. Run E2E tests
    if (step.success) {
      console.log('\n    --- [Phase: E2E Tests] ---');
      phase = 'e2e';
      step = await execute('npm run test:e2e:chromium');
    }

    if (step.success) {
      console.log('\n    ✅ SAFE TO DELETE\n');
    } else {
      console.log(`\n    ❌ FAILED (at ${phase})\n`);
    }

    reportData.push({
      mock: target.id,
      description: target.reason,
      canDelete: step.success,
      failurePhase: step.success ? null : phase,
      logs: step.error || null
    });
  }
} finally {
  // Always restore the file no matter what!
  writeFileSync(MOCKS_FILE, originalContent);
  console.log('\nRestored frappe_mocks.py to original state.');
}

// Generate the JSON report
if (!existsSync(REPORT_OUTPUT_DIR)) {
  mkdirSync(REPORT_OUTPUT_DIR, { recursive: true });
}

const reportDest = resolve(REPORT_OUTPUT_DIR, 'mock-removal-report.json');
writeFileSync(reportDest, JSON.stringify({
  timestamp: new Date().toISOString(),
  results: reportData
}, null, 2));

// Print summary
console.log('\n--- Mock Removal Summary ---');
reportData.forEach(r => {
  const icon = r.canDelete ? '🟢' : '🔴';
  console.log(`${icon} ${r.mock.padEnd(15)} : ${r.canDelete ? 'Safe to remove' : 'Required (Failed during ' + r.failurePhase + ')'}`);
});
console.log('----------------------------');
console.log(`Detailed logs saved to: ${reportDest}`);
