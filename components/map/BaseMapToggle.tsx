'use client';

import { useTranslations } from 'next-intl';
import type { BaseMap } from '@/lib/map-styles';

/** Map / Satellite switch, drawn over the top-left corner of a map. */
export default function BaseMapToggle({ base, onChange }: { base: BaseMap; onChange: (b: BaseMap) => void }) {
  const t = useTranslations('map.baseMap');
  const options: BaseMap[] = ['map', 'satellite'];
  return (
    <div
      role="group"
      aria-label={t('label')}
      className="absolute top-2.5 left-2.5 z-10 flex rounded-md border border-border bg-surface/90 backdrop-blur-sm shadow overflow-hidden"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={base === option}
          onClick={() => onChange(option)}
          className={[
            'px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            base === option ? 'bg-primary text-on-primary' : 'text-muted hover:text-foreground',
          ].join(' ')}
        >
          {t(option)}
        </button>
      ))}
    </div>
  );
}
