const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const cliPackagePath = path.join(
  appRoot,
  'node_modules',
  '@tauri-apps',
  'cli',
  'package.json',
);

let cliEntry;
try {
  const cliPackage = JSON.parse(readFileSync(cliPackagePath, 'utf8'));
  const cliBin = typeof cliPackage.bin === 'string'
    ? cliPackage.bin
    : cliPackage.bin?.tauri;

  if (!cliBin) {
    fail('The installed @tauri-apps/cli package does not expose a Tauri executable.');
  }
  cliEntry = path.resolve(path.dirname(cliPackagePath), cliBin);
} catch (error) {
  fail(`Unable to locate @tauri-apps/cli. Run npm install first. ${error.message}`);
}

const tauri = spawn(process.execPath, [cliEntry, ...args], {
  cwd: appRoot,
  env: process.env,
  stdio: 'inherit',
});

tauri.on('error', (error) => {
  fail(`Unable to start Tauri: ${error.message}`);
});

tauri.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
