import { Monitor, Moon, Sun } from 'lucide-react';
import { cx } from '../ui/cx';
import { useTheme } from '../../context/ThemeContext';

const OPTIONS = [
  {
    id: 'system',
    label: 'System',
    icon: Monitor,
    wash: 'mobile-glass-segment-selected',
    iconColor: 'text-app-accent',
  },
  {
    id: 'light',
    label: 'Light',
    icon: Sun,
    wash: 'mobile-glass-segment-selected',
    iconColor: 'text-app-accent',
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: Moon,
    wash: 'mobile-glass-segment-selected',
    iconColor: 'text-app-accent',
  },
] as const;

/**
 * System / Light / Dark segmented theme picker for mobile Settings.
 * The selected segment gets a soft tinted wash with a matching icon
 * color; Light and Dark pin the preference while System follows the
 * OS. Preset-based preferences resolve to their base tone so exactly
 * one segment is always highlighted.
 */
export function ThemeSegmented() {
  const { themePreference, theme, setThemePreference } = useTheme();
  const selected: 'system' | 'light' | 'dark' =
    themePreference === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark';

  return (
    <div role="radiogroup" aria-label="App theme" className="mobile-glass-segmented flex gap-1 rounded-full p-1">
      {OPTIONS.map(({ id, label, icon: Icon, wash, iconColor }) => {
        const isSelected = id === selected;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={label}
            onClick={() => setThemePreference(id)}
            className={cx(
              'flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-2 transition-colors duration-200 ease-out motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent',
              isSelected ? wash : 'hover:bg-app-hover',
            )}
          >
            <Icon className={cx('h-4.5 w-4.5 shrink-0', isSelected ? iconColor : 'text-app-text-secondary')} aria-hidden="true" />
            <span className={cx('truncate text-sm', isSelected ? 'font-semibold text-app-text' : 'font-medium text-app-text-secondary')}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
