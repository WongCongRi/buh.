export interface AccentPalette {
  hex: string;
  solidBg: string;
  solidHoverBg: string;
  solidFg: string;
  softBgLight: string;
  softBgDark: string;
  textLight: string;
  textDark: string;
  border: string;
}

export const DEFAULT_ACCENT_COLOR = '#7BB6E0';

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Soft Sky', hex: '#7BB6E0' },
  { name: 'Mist Blue', hex: '#93C5E8' },
  { name: 'Powder Slate', hex: '#86A8C9' },
  { name: 'Periwinkle', hex: '#8FA8E0' },
  { name: 'Ice Aqua', hex: '#78BFB8' },
  { name: 'Calm Sage', hex: '#78A88E' },
];

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function normalizeHex(input: string): string {
  const clean = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()}`;
  }
  return DEFAULT_ACCENT_COLOR;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex).slice(1);
  return {
    r: parseInt(norm.slice(0, 2), 16),
    g: parseInt(norm.slice(2, 4), 16),
    b: parseInt(norm.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => clampByte(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  weightB: number
): { r: number; g: number; b: number } {
  return {
    r: clampByte(a.r * (1 - weightB) + b.r * weightB),
    g: clampByte(a.g * (1 - weightB) + b.g * weightB),
    b: clampByte(a.b * (1 - weightB) + b.b * weightB),
  };
}

export function buildAccentPalette(rawHex: string): AccentPalette {
  const hex = normalizeHex(rawHex);
  const rgb = hexToRgb(hex);
  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);

  // Use dark ink on soft/light colors, white on deeper colors
  const solidFg = lum > 0.34 ? '#0F172A' : '#FFFFFF';

  // Subtle hover shift
  const hoverRgb = mixRgb(rgb, { r: 15, g: 23, b: 42 }, lum > 0.34 ? 0.1 : 0.16);
  const solidHoverBg = toHex(hoverRgb.r, hoverRgb.g, hoverRgb.b);

  // Readable accent text on white/off-white background (ensure lum <= 0.18)
  let textLightRgb = { ...rgb };
  for (let step = 0; step < 8; step++) {
    if (relativeLuminance(textLightRgb.r, textLightRgb.g, textLightRgb.b) <= 0.17) break;
    textLightRgb = mixRgb(textLightRgb, { r: 12, g: 20, b: 32 }, 0.24);
  }
  const textLight = toHex(textLightRgb.r, textLightRgb.g, textLightRgb.b);

  // Readable accent text on dark surfaces (ensure lum >= 0.42)
  let textDarkRgb = { ...rgb };
  for (let step = 0; step < 8; step++) {
    if (relativeLuminance(textDarkRgb.r, textDarkRgb.g, textDarkRgb.b) >= 0.45) break;
    textDarkRgb = mixRgb(textDarkRgb, { r: 238, g: 246, b: 255 }, 0.25);
  }
  const textDark = toHex(textDarkRgb.r, textDarkRgb.g, textDarkRgb.b);

  return {
    hex,
    solidBg: hex,
    solidHoverBg,
    solidFg,
    softBgLight: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
    softBgDark: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
    textLight,
    textDark,
    border: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.48)`,
  };
}

export function applyAccentCssVars(rawHex: string, isDark: boolean): void {
  const p = buildAccentPalette(rawHex);
  const root = document.documentElement.style;
  root.setProperty('--tf-accent', p.solidBg);
  root.setProperty('--tf-accent-hover', p.solidHoverBg);
  root.setProperty('--tf-accent-fg', p.solidFg);
  root.setProperty('--tf-accent-text', isDark ? p.textDark : p.textLight);
  root.setProperty('--tf-accent-soft', isDark ? p.softBgDark : p.softBgLight);
  root.setProperty('--tf-accent-border', p.border);
}
