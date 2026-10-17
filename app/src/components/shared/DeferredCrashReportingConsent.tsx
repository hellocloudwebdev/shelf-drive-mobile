import { lazy, Suspense } from 'react';

const CrashReportingConsent = lazy(() => import('./CrashReportingConsent').then(module => ({ default: module.CrashReportingConsent })));

// The app mounts this only after settings load. This boundary defers dialog UI,
// not crash telemetry: configureCrashTelemetry remains in the app's settings effect.
export function DeferredCrashReportingConsent() {
    return <Suspense fallback={null}><CrashReportingConsent /></Suspense>;
}
