import { describe, expect, it } from 'vitest';
import { android } from './index';

// Rust's CachedFileEntry (app/src-tauri/src/lib.rs:718) serializes `file_size`.
// The facade must declare the wire shape so no caller needs a cast to read it.
// The assertions live at the type level: `declaresFileSize` and
// `dropsLegacySizeName` fail to compile (via `npx tsc --noEmit`, which covers
// src/) while the facade declares the wrong field name.
type DeclaredEntry = Awaited<ReturnType<typeof android.listCachedFiles>>[number];

const declaresFileSize: 'file_size' extends keyof DeclaredEntry ? true : never = true;
const dropsLegacySizeName: 'size' extends keyof DeclaredEntry ? never : true = true;

describe('android.listCachedFiles API contract', () => {
  it('declares the Rust CachedFileEntry wire shape (file_size, not size)', () => {
    expect(typeof declaresFileSize).toBe('boolean');
    expect(typeof dropsLegacySizeName).toBe('boolean');
  });
});
