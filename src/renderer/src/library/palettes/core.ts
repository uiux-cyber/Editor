import type { Palette } from '../types';

/** Core palettes. Further packs live next to this file. */
const palettes: Palette[] = [
  {
    id: 'midnight-violet',
    name: 'Midnight Violet',
    dark: true,
    bg: '#0b0c14',
    bg2: '#1a1533',
    surface: '#1f2233',
    primary: '#7c5cff',
    secondary: '#22d3ee',
    accent: '#ff4d8d',
    text: '#ffffff',
    textMuted: '#a9b0c7',
    onPrimary: '#ffffff',
  },
  {
    id: 'paper-ink',
    name: 'Paper & Ink',
    dark: false,
    bg: '#f6f1e7',
    bg2: '#e9e0cf',
    surface: '#ffffff',
    primary: '#16161d',
    secondary: '#c2410c',
    accent: '#e11d48',
    text: '#16161d',
    textMuted: '#6b6558',
    onPrimary: '#f6f1e7',
  },
  {
    id: 'sunset-pop',
    name: 'Sunset Pop',
    dark: true,
    bg: '#1c0f1f',
    bg2: '#4a1942',
    surface: '#2d1832',
    primary: '#ff6b35',
    secondary: '#ffd166',
    accent: '#ef476f',
    text: '#fff8f0',
    textMuted: '#d9b8c4',
    onPrimary: '#1c0f1f',
  },
];

export default palettes;
