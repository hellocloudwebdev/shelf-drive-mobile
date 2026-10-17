const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = read('app/src-tauri/Cargo.toml');
const updater = read('app/src-tauri/vendor/tauri-plugin-updater/Cargo.toml');
const lock = read('app/src-tauri/Cargo.lock');
const policy = read('deny.toml');
const packages = lock.split(/^\[\[package\]\]\s*$/m).slice(1);
const field = (text, key) => text.match(new RegExp(`^${key} = "([^"]+)"$`, 'm'))?.[1];
const zip = packages.filter(p => field(p, 'name') === 'zip');
assert.equal(zip.length, 1, 'The locked graph must contain only one ZIP version');
assert.equal(field(zip[0], 'version'), '9.0.4', 'The locked ZIP version must be 9.0.4');
const patch = manifest.split('[patch.crates-io]')[1] || '';
assert.match(patch, /tauri-plugin-updater\s*=\s*\{\s*path\s*=\s*"vendor\/tauri-plugin-updater"\s*\}/);
assert.match(manifest, /^zip = \{ version = "=9\.0\.4"/m);
const updaterZip = updater.split("[target.'cfg(target_os = \"windows\")'.dependencies.zip]")[1] || '';
assert.match(updaterZip, /^version = "=9\.0\.4"$/m);
assert.match(updaterZip, /^features = \["deflate"\]$/m);
const selectedUpdater = packages.find(p => field(p, 'name') === 'tauri-plugin-updater');
assert.ok(selectedUpdater, 'Updater must remain in the locked dependency graph');
assert.equal(field(selectedUpdater, 'source'), undefined, 'Updater must select the local patched source');
for (const id of ['RUSTSEC-2026-0367', 'RUSTSEC-2026-0368', 'RUSTSEC-2026-0369']) {
  assert.ok(!policy.includes(id), `${id} must remain blocking, not ignored`);
}
console.log('Updater ZIP patch contract passed: zip 9.0.4 only, local updater selected, no ZIP advisory exceptions.');
