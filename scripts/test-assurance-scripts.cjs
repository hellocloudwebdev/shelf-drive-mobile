const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptRoot = __dirname;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-drive-assurance-'));
const dependencyReport = path.join(temporaryRoot, 'gradle-dependencies.txt');
const sbomPath = path.join(temporaryRoot, 'android-sbom.cdx.json');
const checksumPath = path.join(temporaryRoot, 'SHA256SUMS.txt');

fs.writeFileSync(dependencyReport, [
  '+--- androidx.core:core-ktx:1.12.0',
  '\\--- com.squareup.okhttp3:okhttp:4.11.0 -> 4.12.0',
  '',
].join('\n'));

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptRoot, script), ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${script} failed`);
}

run('generate-gradle-sbom.cjs', [dependencyReport, sbomPath]);
const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5') {
  throw new Error('Gradle SBOM is not CycloneDX 1.5.');
}
if (sbom.components.length !== 2 || !sbom.components.some(component => component.version === '4.12.0')) {
  throw new Error('Gradle SBOM did not preserve the resolved dependency graph.');
}

run('generate-checksums.cjs', [temporaryRoot, checksumPath]);
const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n');
if (checksumLines.length !== 2 || !checksumLines.every(line => /^[0-9a-f]{64}  .+/.test(line))) {
  throw new Error('Checksum manifest is incomplete or malformed.');
}

const gitPinChecker = path.join(scriptRoot, 'check-rust-git-pins.cjs');
const pinFixtures = [
  {
    name: 'full revision',
    source: 'grammers = { git = "https://example.test/repo", rev = "0123456789abcdef0123456789abcdef01234567" }\n',
    expected: 0,
  },
  {
    name: 'abbreviated revision',
    source: 'grammers = { git = "https://example.test/repo", rev = "0123456" }\n',
    expected: 1,
  },
  {
    name: 'missing revision',
    source: 'grammers = { git = "https://example.test/repo", branch = "main" }\n',
    expected: 1,
  },
];
for (const fixture of pinFixtures) {
  const manifestPath = path.join(temporaryRoot, `Cargo-${fixture.name.replace(/\s+/g, '-')}.toml`);
  fs.writeFileSync(manifestPath, fixture.source);
  const result = spawnSync(process.execPath, [gitPinChecker, manifestPath], { encoding: 'utf8' });
  if (result.status !== fixture.expected) {
    throw new Error(`Git pin checker failed its ${fixture.name} contract: ${result.stderr || result.stdout}`);
  }
}

const { verifyAabFingerprintOutput } = require('../app/scripts/verify-aab-signer.cjs');
const pinnedFingerprint = 'AB'.repeat(32);
const fingerprintWithColons = pinnedFingerprint.match(/.{2}/g).join(':');
if (verifyAabFingerprintOutput(`Certificate fingerprints:\n  SHA256: ${fingerprintWithColons}\n`, pinnedFingerprint) !== pinnedFingerprint) {
  throw new Error('AAB signer verifier did not normalize the matching certificate fingerprint.');
}
for (const output of [
  `SHA256: ${'CD'.repeat(32)}`,
  'no certificate fingerprint present',
  `SHA256: ${fingerprintWithColons}\nSHA256: ${'CD'.repeat(32)}`,
]) {
  let rejected = false;
  try {
    verifyAabFingerprintOutput(output, pinnedFingerprint);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('AAB signer verifier accepted a mismatched or ambiguous fingerprint.');
}

const resolverScript = path.join(scriptRoot, 'resolve-previous-android-manifest.sh');
const fakeBin = path.join(temporaryRoot, 'fake-bin');
const fakeGh = path.join(fakeBin, 'gh');
fs.mkdirSync(fakeBin, { recursive: true });
fs.writeFileSync(fakeGh, `#!/bin/sh
set -eu
command="$1 $2"
case "$command" in
  "release list")
    case "$GH_SCENARIO" in
      list-failure) exit 17 ;;
      no-release) printf '[]\\n' ;;
      *) printf '[{"tagName":"v4.4.4","isDraft":false}]\\n' ;;
    esac
    ;;
  "release view")
    case "$GH_SCENARIO" in
      view-failure) exit 18 ;;
      no-asset) printf '{"assets":[]}\\n' ;;
      *) printf '{"assets":[{"name":"android-update.json"}]}\\n' ;;
    esac
    ;;
  "release download")
    if [ "$GH_SCENARIO" = download-failure ]; then exit 19; fi
    destination=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then destination="$2"; shift 2; else shift; fi
    done
    mkdir -p "$destination"
    printf '{"versionCode":4004004}\\n' > "$destination/android-update.json"
    printf 'download notice on stdout\\n'
    ;;
  *) exit 64 ;;
esac
`);
fs.chmodSync(fakeGh, 0o755);

function runPreviousManifestResolver(scenario) {
  const outputDir = path.join(temporaryRoot, `previous-${scenario}`);
  const result = spawnSync('bash', [resolverScript, outputDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      GH_SCENARIO: scenario,
      GITHUB_REPOSITORY: 'hellocloudwebdev/shelf-drive-mobile',
    },
  });
  return { outputDir, result };
}

for (const scenario of ['no-release', 'no-asset']) {
  const { result } = runPreviousManifestResolver(scenario);
  if (result.status !== 0 || result.stdout.trim()) {
    throw new Error(`Previous-manifest resolver mishandled expected ${scenario}: ${result.stderr || result.stdout}`);
  }
}
for (const scenario of ['list-failure', 'view-failure', 'download-failure']) {
  const { result } = runPreviousManifestResolver(scenario);
  if (result.status === 0) {
    throw new Error(`Previous-manifest resolver failed open for ${scenario}.`);
  }
}
const resolvedManifest = runPreviousManifestResolver('success');
const resolvedPath = resolvedManifest.result.stdout.trim();
if (resolvedManifest.result.status !== 0 || !resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).size) {
  throw new Error(`Previous-manifest resolver did not return a nonempty prior manifest: ${resolvedManifest.result.stderr || resolvedManifest.result.stdout}`);
}

console.log('[assurance] SBOM, checksum, immutable git-pin, AAB signer, and fail-closed release-version contracts passed.');
