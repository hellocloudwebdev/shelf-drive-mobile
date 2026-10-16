#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function gitDependencies(manifest) {
  const dependencies = [];
  const startPattern = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{/gm;
  let match;

  while ((match = startPattern.exec(manifest)) !== null) {
    const name = match[1];
    const openBrace = startPattern.lastIndex - 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = openBrace;

    for (; end < manifest.length; end += 1) {
      const char = manifest[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '#') {
        const newline = manifest.indexOf('\n', end);
        if (newline === -1) {
          end = manifest.length;
          break;
        }
        end = newline;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const body = manifest.slice(openBrace + 1, end);
    const git = body.match(/(?:^|,)\s*git\s*=\s*"([^"]+)"/);
    if (!git) continue;
    const rev = body.match(/(?:^|,)\s*rev\s*=\s*"([^"]+)"/);
    dependencies.push({ name, git: git[1], rev: rev?.[1] ?? null });
    startPattern.lastIndex = Math.max(startPattern.lastIndex, end + 1);
  }

  return dependencies;
}

function validate(manifest) {
  const dependencies = gitDependencies(manifest);
  return {
    dependencies,
    errors: dependencies
      .filter(({ rev }) => !rev || !/^[0-9a-f]{40}$/.test(rev))
      .map(({ name, git, rev }) =>
        `${name}: git dependency ${git} must use a full 40-character lowercase commit revision (got ${JSON.stringify(rev)})`,
      ),
  };
}

if (require.main === module) {
  const manifestPath = path.resolve(process.argv[2] || path.join(__dirname, '../app/src-tauri/Cargo.toml'));
  let source;
  try {
    source = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    console.error(`[git-pins] Unable to read ${manifestPath}: ${error.message}`);
    process.exit(2);
  }
  const result = validate(source);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`[git-pins] FAIL ${error}`);
    process.exit(1);
  }
  console.log(`[git-pins] PASS ${result.dependencies.length} git dependencies use immutable full commit revisions.`);
}

module.exports = { gitDependencies, validate };
