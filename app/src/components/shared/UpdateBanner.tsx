import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, RefreshCw, Sparkles } from 'lucide-react';
import type { UpdateInstallPhase } from '../../services/updateReliability';
import { useTranslation } from 'react-i18next';

interface UpdateBannerProps {
    available: boolean;
    version: string | null;
    downloading: boolean;
    progress: number;
    phase: UpdateInstallPhase | null;
    managedByPackageManager: boolean;
    onUpdate: () => void;
    onDismiss: () => void;
}

export function UpdateBanner({
    available,
    version,
    downloading,
    progress,
    phase,
    managedByPackageManager,
    onUpdate,
    onDismiss
}: UpdateBannerProps) {
    const { t } = useTranslation();
    return (
        <AnimatePresence>
            {available && (
                <motion.div
                    initial={{ opacity: 0, y: -50 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -50 }}
                    className="fixed inset-x-0 top-0 z-50 px-3 pb-3 pt-[calc(max(env(safe-area-inset-top,0px),24px)+0.75rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] bg-gradient-to-r from-telegram-primary/90 via-blue-500/90 to-purple-500/90 backdrop-blur-sm shadow-lg"
                >
                    <div className="mx-auto flex max-w-screen-lg flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
                        <div className="flex min-w-0 items-center justify-center gap-2 text-center sm:justify-start sm:text-left">
                            <Sparkles className="h-5 w-5 shrink-0 text-yellow-300 animate-pulse" />
                            <span className="min-w-0 text-white font-medium">
                                {downloading ? (
                                    <>{phase === 'verifying' ? 'Verifying signed update…' : phase === 'installing' ? 'Installing update…' : `Downloading update… ${progress}%`}</>
                                ) : (
                                    <>A new version ({version}) is available!</>
                                )}
                            </span>
                        </div>

                        <div className="flex shrink-0 items-center justify-center gap-2">
                            {downloading ? (
                                <div className="flex items-center gap-2">
                                    <RefreshCw className="h-4 w-4 text-white animate-spin" />
                                    <div className="h-2 w-32 overflow-hidden rounded-full bg-white/30">
                                        <motion.div
                                            className="h-full rounded-full bg-white"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={onUpdate}
                                    className="flex max-w-full items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-1.5 font-semibold text-telegram-primary shadow-md transition-colors hover:bg-white/90"
                                >
                                    <Download className="h-4 w-4 shrink-0" />
                                    {managedByPackageManager ? t('common.open') : t('settings.update_restart')}
                                </button>
                            )}

                            {!downloading && (
                                <button
                                    onClick={onDismiss}
                                    className="shrink-0 p-1 text-white/70 transition-colors hover:text-white"
                                    title={t('common.close')}
                                    aria-label={t('common.close')}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
