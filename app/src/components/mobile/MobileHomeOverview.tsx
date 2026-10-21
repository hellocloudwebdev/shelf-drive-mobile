import { Clapperboard, FileText, Image as ImageIcon, Layers3, HardDrive } from 'lucide-react';
import type { TelegramFile } from '../../types';
import { formatBytes, isImageFile, isVideoFile } from '../../utils';

type OverviewCategory = 'photos' | 'videos' | 'documents';

export interface MobileOverviewStats {
  fileCount: number;
  knownBytes: number;
  photos: number;
  videos: number;
  documents: number;
}

/** Summarize only files in the supplied live listing; folders aren't counted. */
export function deriveMobileOverviewStats(files: readonly TelegramFile[]): MobileOverviewStats {
  const actualFiles = files.filter(file => file.type !== 'folder' && !file.name.endsWith('/'));
  const photos = actualFiles.filter(file => isImageFile(file.name)).length;
  const videos = actualFiles.filter(file => isVideoFile(file.name, file.mime_type)).length;
  return {
    fileCount: actualFiles.length,
    knownBytes: actualFiles.reduce((sum, file) => sum + (Number.isFinite(file.size) && file.size > 0 ? file.size : 0), 0),
    photos,
    videos,
    documents: actualFiles.length - photos - videos,
  };
}

interface MobileHomeOverviewProps {
  files: readonly TelegramFile[];
  loading: boolean;
  contextLabel: string;
  labels: { overview: string; files: string; knownSize: string; photos: string; videos: string; documents: string };
  onNavigate: (tab: OverviewCategory) => void;
}

export function MobileHomeOverview({ files, loading, contextLabel, labels, onNavigate }: MobileHomeOverviewProps) {
  const stats = deriveMobileOverviewStats(files);
  const categories = [
    { id: 'photos', label: labels.photos, count: stats.photos, Icon: ImageIcon, tone: 'text-sky-700 bg-sky-500/10' },
    { id: 'videos', label: labels.videos, count: stats.videos, Icon: Clapperboard, tone: 'text-cyan-800 bg-cyan-500/10' },
    { id: 'documents', label: labels.documents, count: stats.documents, Icon: FileText, tone: 'text-blue-700 bg-blue-500/10' },
  ] as const;

  return (
    <section className="mobile-home-overview space-y-3" aria-label={labels.overview}>
      <div className="mobile-storage-card glass-surface overflow-hidden rounded-[1.5rem] border border-white/50 p-4 shadow-[var(--shadow-raised)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-text-secondary">{labels.overview}</p>
            <p className="mt-1 truncate text-xs text-app-text-tertiary">{contextLabel}</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700" aria-hidden="true">
            <Layers3 className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/35 px-3 py-3 dark:bg-white/[0.06]">
            <div className="flex items-center gap-1.5 text-app-text-secondary">
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{labels.files}</span>
            </div>
            <p className="mt-1 text-xl font-semibold tracking-tight text-app-text" aria-live="polite">{loading ? '—' : stats.fileCount}</p>
          </div>
          <div className="rounded-2xl bg-white/35 px-3 py-3 dark:bg-white/[0.06]">
            <div className="flex items-center gap-1.5 text-app-text-secondary">
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{labels.knownSize}</span>
            </div>
            <p className="mt-1 truncate text-xl font-semibold tracking-tight text-app-text" aria-live="polite">{loading ? '—' : formatBytes(stats.knownBytes)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2" aria-label={labels.overview}>
        {categories.map(({ id, label, count, Icon, tone }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className="mobile-category-tile glass-surface flex min-h-[6.1rem] min-w-0 flex-col items-start justify-between rounded-[1.35rem] border border-white/50 p-3 text-start shadow-[var(--shadow-raised)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent active:scale-[0.98]"
            aria-label={`${label}, ${loading ? 'loading' : count}`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`} aria-hidden="true"><Icon className="h-4.5 w-4.5" /></span>
            <span className="mt-2 min-w-0 w-full">
              <span className="block truncate text-[11px] font-semibold text-app-text">{label}</span>
              <span className="mt-0.5 block text-[10px] text-app-text-secondary">{loading ? '—' : count}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
