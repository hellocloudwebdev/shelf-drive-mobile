import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { settings as settingsApi } from '../api/index';
import { DEFAULT_SETTINGS } from '../config/defaultSettings';
import {
    markProxySecretMigrated,
    readPersistedSettings,
    writePersistedSettings,
} from '../services/settingsPersistence';
import type { Settings } from '../types/settings';

export type { Settings } from '../types/settings';

interface SettingsContextType {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    updateSettings: (updates: Partial<Settings>) => void;
    resetSettings: () => void;
    isLoaded: boolean;
    persistenceStatus: 'loading' | 'saved' | 'saving' | 'error';
    retryPersistence: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [isLoaded, setIsLoaded] = useState(false);
    const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
    const latestSettingsRef = useRef<Settings>(DEFAULT_SETTINGS);
    const preLoadEditsRef = useRef<Partial<Settings>>({});
    const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
    const persistenceRevisionRef = useRef(0);

    useEffect(() => {
        const loadSettings = async () => {
            let loadFailed = false;
            const loaded = await readPersistedSettings(DEFAULT_SETTINGS, undefined, () => {
                loadFailed = true;
            });
            if (loaded.proxyPassword) {
                try {
                    await settingsApi.migrateProxySecret(loaded.proxyPassword);
                    markProxySecretMigrated();
                    loaded.proxyPassword = '';
                    await writePersistedSettings(loaded);
                } catch (error) {
                    // Keep the legacy value intact until secure storage becomes
                    // available. Never include the credential in diagnostic logs.
                    console.error('[Settings] Secure proxy credential migration is pending.');
                    loadFailed = true;
                }
            }
            const editsMadeBeforeLoad = Object.keys(preLoadEditsRef.current).length > 0;
            const reconciled = { ...loaded, ...preLoadEditsRef.current };
            preLoadEditsRef.current = {};
            setSettings(reconciled);
            latestSettingsRef.current = reconciled;
            setIsLoaded(true);
            if (editsMadeBeforeLoad) {
                const revision = ++persistenceRevisionRef.current;
                setPersistenceStatus('saving');
                const operation = persistenceQueueRef.current.then(() => writePersistedSettings(reconciled));
                persistenceQueueRef.current = operation.catch(() => undefined);
                try {
                    await operation;
                    if (revision === persistenceRevisionRef.current) setPersistenceStatus(loadFailed ? 'error' : 'saved');
                } catch {
                    if (revision === persistenceRevisionRef.current) setPersistenceStatus('error');
                }
            } else {
                setPersistenceStatus(loadFailed ? 'error' : 'saved');
            }
        };
        void loadSettings();
    }, []);

    const persistSettings = useCallback((next: Settings): Promise<void> => {
        latestSettingsRef.current = next;
        const revision = ++persistenceRevisionRef.current;
        setPersistenceStatus('saving');
        const operation = persistenceQueueRef.current.then(() => writePersistedSettings(next));
        persistenceQueueRef.current = operation.catch(() => undefined);
        return operation.then(
            () => {
                if (revision === persistenceRevisionRef.current) setPersistenceStatus('saved');
            },
            () => {
                if (revision === persistenceRevisionRef.current) setPersistenceStatus('error');
                throw new Error('Settings persistence failed');
            },
        );
    }, []);

    const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        if (!isLoaded) preLoadEditsRef.current[key] = value;
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            if (isLoaded) void persistSettings(next).catch(() => undefined);
            return next;
        });
    }, [isLoaded, persistSettings]);

    const updateSettings = useCallback((updates: Partial<Settings>) => {
        if (!isLoaded) Object.assign(preLoadEditsRef.current, updates);
        setSettings(prev => {
            const next = { ...prev, ...updates };
            if (isLoaded) void persistSettings(next).catch(() => undefined);
            return next;
        });
    }, [isLoaded, persistSettings]);

    const resetSettings = useCallback(() => {
        if (!isLoaded) preLoadEditsRef.current = { ...DEFAULT_SETTINGS };
        setSettings(DEFAULT_SETTINGS);
        latestSettingsRef.current = DEFAULT_SETTINGS;
        if (isLoaded) void persistSettings(DEFAULT_SETTINGS).catch(() => undefined);
        void settingsApi.clearProxySecret().catch(() => {
            console.error('[Settings] Unable to remove the saved proxy credential.');
        });
    }, [isLoaded, persistSettings]);

    const retryPersistence = useCallback(
        () => persistSettings(latestSettingsRef.current),
        [persistSettings],
    );

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, updateSettings, resetSettings, isLoaded, persistenceStatus, retryPersistence }}>
            {children}
        </SettingsContext.Provider>
    );
}

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error('useSettings must be used within a SettingsProvider');
    return context;
};
