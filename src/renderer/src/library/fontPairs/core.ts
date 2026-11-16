import type { FontPair } from '../types';

/** Core font pairings. Further packs live next to this file. */
const fontPairs: FontPair[] = [
  { id: 'modern-bold', name: 'Modern Bold', heading: { family: 'Montserrat', weight: 900, uppercase: true, letterSpacing: 0.01 }, body: { family: 'Inter', weight: 500 } },
  { id: 'editorial', name: 'Editorial', heading: { family: 'Playfair Display', weight: 800 }, body: { family: 'Inter', weight: 400 } },
  { id: 'poster', name: 'Poster', heading: { family: 'Bebas Neue', weight: 400, uppercase: true, letterSpacing: 0.04 }, body: { family: 'Poppins', weight: 500 } },
];

export default fontPairs;
