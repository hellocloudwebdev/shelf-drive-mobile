import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..', '..');
const candidate = readFileSync(resolve(root, '.github/workflows/android-candidate.yml'), 'utf8');
const quality = readFileSync(resolve(root, '.github/workflows/quality-assurance.yml'), 'utf8');
const android = readFileSync(resolve(root, '.github/workflows/android.yml'), 'utf8');

describe('validation-only Android candidate workflow', () => {
  it('is limited to the authorized candidate branch without release or tag writes', () => {
    expect(candidate).toContain("branches: ['release-candidate/4.4.10-native-traces']");
    expect(candidate).toContain("run: test \"$CANDIDATE_REF\" = 'refs/heads/release-candidate/4.4.10-native-traces'");
    expect(candidate).not.toContain('contents: write');
    for (const publication of ['createRelease', 'updateRelease', 'gh release create', 'gh release upload', 'git tag', 'tags:']) {
      expect(candidate).not.toContain(publication);
    }
  });

  it('requires release, dependency, Windows-updater and coverage gates before signed Android builds', () => {
    expect(candidate).toContain('uses: ./.github/workflows/dependency-assurance.yml');
    expect(candidate).toContain('uses: ./.github/workflows/quality-assurance.yml');
    expect(quality).toContain('workflow_call:');
    expect(candidate).toContain('needs: [verify-candidate, dependency-assurance, quality-assurance]');
    expect(candidate).toContain('uses: ./.github/workflows/android.yml');
    expect(candidate).toContain('npm run test:coverage');
    expect(candidate).toContain('npm run build:verify');
    expect(candidate).toContain('npm run i18n:validate');
    expect(candidate).toContain('npm run i18n:scan');
    expect(candidate).toContain('cargo test --lib');
    expect(candidate).toContain('cargo fmt --all -- --check');
    expect(candidate).toContain('cargo clippy --lib --all-targets -- -D warnings');
    expect(candidate).toContain('--previous-manifest "$previous_manifest"');
    expect(candidate).toContain('args=(--tag "v${version}" --changelog ../CHANGELOG.md)');
    expect(android).toContain('Run bounded native exit trace JVM policy and storage checks');
    expect(android).toContain('bash scripts/test-native-exit-traces.sh');
  });

  it('retains universal-only assets, signed update metadata, SBOMs, attestations and verified checksums', () => {
    expect(candidate).toContain('Unexpected candidate asset set');
    expect(candidate).toContain('`ShelfDrive_${version}.apk`, `ShelfDrive_${version}.aab`');
    expect(candidate).toContain("'android-update.json', 'android-update.json.sig'");
    expect(candidate).toContain("'shelf-drive-source-sbom.cdx.json', 'telegram-drive-android-sbom.cdx.json'");
    expect(candidate).toContain('provenance.sigstore.json');
    expect(candidate).toContain('sbom-attestation.sigstore.json');
    expect(candidate).toContain('sha256sum -c SHA256SUMS && sha256sum -c SHA256SUMS.txt');
    expect(candidate.indexOf('rm candidate-assets/SHA256SUMS.txt')).toBeLessThan(candidate.indexOf('- name: Attest candidate provenance'));
    expect(candidate).toContain('name: shelf-drive-android-candidate');
  });
});
