import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { reportCrash } from './services/crashTelemetry';

// In browser preview environments outside the native Tauri container,
// provide lightweight IPC fallbacks so the UI loads and renders smoothly.
if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'cmd_get_startup_health') return { healthy: true, issues: [] };
        if (cmd === 'cmd_check_connection') return false;
        if (cmd === 'cmd_load_api_hash' || cmd === 'cmd_store_api_hash') return null;
        if (cmd === 'cmd_auth_qr_login') return 'tg://login?token=preview_token';
        if (cmd === 'cmd_auth_qr_poll') return { success: false };
        if (cmd === 'cmd_auth_request_code') {
          return {
            status: 'code_required',
            delivery: 'telegram_app',
            codeLength: 5,
            numericCode: true,
            resendAfterSeconds: 60,
          };
        }
        if (cmd === 'cmd_auth_sign_in') return { success: true };
        if (cmd === 'cmd_get_bandwidth') return { uploadSpeed: 0, downloadSpeed: 0 };
        if (cmd === 'cmd_get_offline_cache_status') return { count: 0, sizeBytes: 0 };
        return null;
      },
      transformCallback: () => () => {},
    },
  });
}

window.onerror = function (message, source, lineno, colno, error) {
  console.error("Global JS Error:", message, "at", source, lineno + ":" + colno, error?.stack || error);
  reportCrash(error || new Error(String(message)), 'window');
  return false;
};

window.addEventListener("unhandledrejection", function (event) {
  console.error("Unhandled Promise Rejection:", event.reason, event.reason?.stack || event.reason);
  reportCrash(event.reason, 'promise');
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
