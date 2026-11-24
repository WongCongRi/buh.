import { VisualStyle } from '../types/taskflow';

export interface StyleThemeTokens {
  label: string;
  surfaceBg: string;
  cardBg: string;
  subtleBg: string;
  cardRadius: string;
  buttonRadius: string;
  rowPadding: string;
  accentText: string;
  accentBg: string;
  accentSoftBg: string;
  accentBorder: string;
  divider: string;
  headingScale: string;
  densityNote: string;
}

export function getDeviceSurfaceHex(style: VisualStyle, isDark: boolean): string {
  switch (style) {
    case VisualStyle.Samsung:
      return isDark ? '#0D1014' : '#F4F6F9';
    case VisualStyle.Professional:
      return isDark ? '#0E1113' : '#F8F9FA';
    case VisualStyle.Minimal:
    default:
      return isDark ? '#111312' : '#FAFAF8';
  }
}

export function getDeviceStyleTokens(style: VisualStyle): StyleThemeTokens {
  const dynamicAccent = {
    accentText: 'text-[var(--tf-accent-text)]',
    accentBg: 'bg-[var(--tf-accent)] text-[var(--tf-accent-fg)]',
    accentSoftBg: 'bg-[var(--tf-accent-soft)]',
    accentBorder: 'border-[var(--tf-accent-border)]',
  };

  switch (style) {
    case VisualStyle.Samsung:
      return {
        label: 'Samsung One UI',
        surfaceBg: 'bg-[#F4F6F9] dark:bg-[#0D1014]',
        cardBg: 'bg-white dark:bg-[#191E24] border border-slate-200/70 dark:border-slate-800/80 shadow-xs',
        subtleBg: 'bg-[#E9EEF5] dark:bg-[#222831]',
        cardRadius: 'rounded-[20px]',
        buttonRadius: 'rounded-xl',
        rowPadding: 'px-3.5 py-2.5',
        ...dynamicAccent,
        divider: 'border-slate-200/70 dark:border-slate-800/80',
        headingScale: 'text-[20px] tracking-tight leading-tight',
        densityNote: 'Squircle surfaces · Soft tonal elevation · TickTick touch cushions',
      };

    case VisualStyle.Professional:
      return {
        label: 'Professional Dense',
        surfaceBg: 'bg-[#F8F9FA] dark:bg-[#0E1113]',
        cardBg: 'bg-white dark:bg-[#161A1D] border border-zinc-200 dark:border-zinc-800',
        subtleBg: 'bg-zinc-100 dark:bg-zinc-800/70',
        cardRadius: 'rounded-lg',
        buttonRadius: 'rounded-md',
        rowPadding: 'px-3 py-2',
        ...dynamicAccent,
        divider: 'border-zinc-200 dark:border-zinc-800',
        headingScale: 'text-[19px] tracking-tight leading-tight',
        densityNote: 'Crisp rows · 8px corners · Comfortable reading density',
      };

    case VisualStyle.Minimal:
    default:
      return {
        label: 'Minimal Calm',
        surfaceBg: 'bg-[#FAFAF8] dark:bg-[#111312]',
        cardBg: 'bg-white dark:bg-[#181B19] border border-stone-200/80 dark:border-stone-800',
        subtleBg: 'bg-stone-100/80 dark:bg-stone-800/60',
        cardRadius: 'rounded-2xl',
        buttonRadius: 'rounded-xl',
        rowPadding: 'px-3.5 py-2.5',
        ...dynamicAccent,
        divider: 'border-stone-200/75 dark:border-stone-800/80',
        headingScale: 'text-[20px] tracking-[-0.02em] leading-tight',
        densityNote: 'Balanced whitespace · Quiet hairlines · TickTick-grade legibility',
      };
  }
}
