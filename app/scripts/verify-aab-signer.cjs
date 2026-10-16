#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

function normalizeFingerprint(value) {
  const normalized = String(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (normalized.length !== 64) {
    throw new Error('A SHA-256 signing certificate fingerprint must contain exactly 64 hexadecimal digits.');
  }
  return normalized;
}

function verifyAabFingerprintOutput(output, expectedFingerprint) {
  const fingerprints = [...String(output).matchAll(/SHA256:\s*([0-9a-f: ]+)/gi)]
    .map(match => normalizeFingerprint(match[1]));
  if (fingerprints.length !== 1) {
    throw new Error(`Expected exactly one AAB signer SHA-256 fingerprint, found ${fingerprints.length}.`);
  }

  const expected = normalizeFingerprint(expectedFingerprint);
  if (fingerprints[0] !== expected) {
    throw new Error('Android App Bundle certificate does not match the pinned production certificate.');
  }
  return fingerprints[0];
}

function verifyAabSigner(aabPath, expectedFingerprint) {
  const result = spawnSync('keytool', ['-printcert', '-jarfile', aabPath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to read the Android App Bundle signer certificate.');
  }
  return verifyAabFingerprintOutput(result.stdout, expectedFingerprint);
}

if (require.main === module) {
  const [, , aabPath, expectedFingerprint] = process.argv;
  if (!aabPath || !expectedFingerprint) {
    console.error('Usage: verify-aab-signer.cjs <app.aab> <pinned-SHA256-fingerprint>');
    process.exit(2);
  }
  try {
    verifyAabSigner(aabPath, expectedFingerprint);
    console.log('Android App Bundle signer matches the pinned production certificate.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { normalizeFingerprint, verifyAabFingerprintOutput, verifyAabSigner };
