/**
 * Low-level Tauri IPC adapter.
 *
 * This is the ONLY module in the application that imports from
 * `@tauri-apps/api/core` and `@tauri-apps/api/event`. All higher-level API
 * modules call the functions exported here; UI components should never
 * import Tauri directly.
 *
 * Security note: this adapter is a transport layer, not a security layer.
 * Rust remains authoritative for all authorization, validation, and
 * filesystem operations (Steps 05–10).
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Invoke a Tauri command and return the typed result. */
export function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

/**
 * Add a UI-side watchdog for commands whose native implementations also have
 * their own deadlines. This releases callers if the IPC response is lost; it
 * does not cancel the native command.
 */
export function tauriInvokeWithTimeout<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve()
      .then(() => tauriInvoke<T>(command, args))
      .then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/** Invoke a Tauri command, discarding the result. */
export function tauriInvokeVoid(command: string, args?: Record<string, unknown>): Promise<void> {
  return invoke<void>(command, args);
}

/** Listen to a Tauri event emitted from the Rust backend. Returns unlisten. */
export function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return listen<T>(event, (e) => handler(e.payload));
}

/** Serve a local file path as a URL consumable by webview media elements. */
export function tauriConvertFileSrc(filePath: string): string {
  return convertFileSrc(filePath);
}
