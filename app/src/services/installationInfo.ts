import { settings } from '../api/index';

export interface InstallationInfo {
    managedByPackageManager: boolean;
    packageManager: 'pacman' | null;
}

// Mobile repository divergence (Docs/SHARED_CORE_SYNC.md): this repo's
// releases — including the signed android-update.json — are published here.
export const RELEASES_URL = 'https://github.com/hellocloudwebdev/shelf-drive-mobile/releases/latest';

const SELF_MANAGED_INSTALLATION: InstallationInfo = {
    managedByPackageManager: false,
    packageManager: null,
};

let installationInfoPromise: Promise<InstallationInfo> | null = null;

export function getInstallationInfo(): Promise<InstallationInfo> {
    if (!installationInfoPromise) {
        installationInfoPromise = settings.getInstallationInfo()
            .catch(() => SELF_MANAGED_INSTALLATION);
    }
    return installationInfoPromise;
}
