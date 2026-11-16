import type { FontPair } from '../types';

/**
 * Curated pairings with distinct personalities. Every heading face has enough stroke weight to
 * survive outlines, glows and small thumbnails; tracking and case follow each face's design
 * (condensed poster faces are set in tracked capitals, scripts are never forced to upper case).
 */
const fontPairs: FontPair[] = [
  // ---- Geometric / modern ---------------------------------------------------------------------
  { id: 'geometric-pop', name: 'Geometric Pop', heading: { family: 'Poppins', weight: 800 }, body: { family: 'Poppins', weight: 400 } },
  { id: 'grotesk-studio', name: 'Grotesk Studio', heading: { family: 'Space Grotesk', weight: 700 }, body: { family: 'Inter', weight: 400 } },
  { id: 'gallery-syne', name: 'Gallery Syne', heading: { family: 'Syne', weight: 800 }, body: { family: 'Inter', weight: 400 } },
  { id: 'impact-black', name: 'Impact Black', heading: { family: 'Archivo Black', weight: 400, uppercase: true, letterSpacing: 0.01 }, body: { family: 'Inter', weight: 500 } },

  // ---- Editorial / luxury serif ---------------------------------------------------------------
  { id: 'serif-journal', name: 'Serif Journal', heading: { family: 'DM Serif Display', weight: 400 }, body: { family: 'Inter', weight: 400 } },
  { id: 'maison-luxe', name: 'Maison Luxe', heading: { family: 'Playfair Display', weight: 600, uppercase: true, letterSpacing: 0.08 }, body: { family: 'Raleway', weight: 500, letterSpacing: 0.02 } },
  { id: 'fashion-fatface', name: 'Fashion Fatface', heading: { family: 'Abril Fatface', weight: 400 }, body: { family: 'Raleway', weight: 500 } },
  { id: 'playfair-modern', name: 'Playfair Modern', heading: { family: 'Playfair Display', weight: 800 }, body: { family: 'Space Grotesk', weight: 400 } },

  // ---- Condensed poster -----------------------------------------------------------------------
  { id: 'headline-condensed', name: 'Headline Condensed', heading: { family: 'Anton', weight: 400, uppercase: true, letterSpacing: 0.02 }, body: { family: 'Inter', weight: 500 } },
  { id: 'bulletin-oswald', name: 'Bulletin', heading: { family: 'Oswald', weight: 600, uppercase: true, letterSpacing: 0.03 }, body: { family: 'Raleway', weight: 500 } },
  { id: 'cinema-bebas', name: 'Cinema Poster', heading: { family: 'Bebas Neue', weight: 400, uppercase: true, letterSpacing: 0.08 }, body: { family: 'Montserrat', weight: 400 } },

  // ---- Friendly / playful ---------------------------------------------------------------------
  { id: 'friendly-round', name: 'Friendly Round', heading: { family: 'Rubik', weight: 800 }, body: { family: 'Rubik', weight: 400 } },
  { id: 'groove-shrikhand', name: 'Groove', heading: { family: 'Shrikhand', weight: 400 }, body: { family: 'Poppins', weight: 500 } },
  { id: 'comic-pop', name: 'Comic Pop', heading: { family: 'Bangers', weight: 400, uppercase: true, letterSpacing: 0.04 }, body: { family: 'Rubik', weight: 500 } },

  // ---- Script + sans --------------------------------------------------------------------------
  { id: 'signature-script', name: 'Signature', heading: { family: 'Dancing Script', weight: 700 }, body: { family: 'Montserrat', weight: 500 } },
  { id: 'sunny-script', name: 'Sunny Script', heading: { family: 'Pacifico', weight: 400 }, body: { family: 'Poppins', weight: 400 } },
  { id: 'marker-zine', name: 'Marker Zine', heading: { family: 'Permanent Marker', weight: 400 }, body: { family: 'Rubik', weight: 400 } },
  { id: 'notebook-caveat', name: 'Notebook', heading: { family: 'Caveat', weight: 700 }, body: { family: 'Inter', weight: 400 } },

  // ---- Retro ----------------------------------------------------------------------------------
  { id: 'retro-righteous', name: 'Retro Righteous', heading: { family: 'Righteous', weight: 400 }, body: { family: 'Rubik', weight: 400 } },
  { id: 'diner-lobster', name: 'Diner', heading: { family: 'Lobster', weight: 400 }, body: { family: 'Oswald', weight: 400, letterSpacing: 0.02 } },
  { id: 'pixel-arcade', name: 'Pixel Arcade', heading: { family: 'Press Start 2P', weight: 400, uppercase: true }, body: { family: 'JetBrains Mono', weight: 500 } },

  // ---- Tech / mono accent ---------------------------------------------------------------------
  { id: 'signal-mono', name: 'Signal Mono', heading: { family: 'Space Grotesk', weight: 700, letterSpacing: -0.01 }, body: { family: 'JetBrains Mono', weight: 400 } },
  { id: 'terminal-mono', name: 'Terminal', heading: { family: 'JetBrains Mono', weight: 800, uppercase: true, letterSpacing: -0.02 }, body: { family: 'Inter', weight: 400 } },

  // ---- Minimal light --------------------------------------------------------------------------
  { id: 'air-raleway', name: 'Air', heading: { family: 'Raleway', weight: 300, uppercase: true, letterSpacing: 0.16 }, body: { family: 'Raleway', weight: 400 } },
  { id: 'whisper-montserrat', name: 'Whisper', heading: { family: 'Montserrat', weight: 300, uppercase: true, letterSpacing: 0.2 }, body: { family: 'Inter', weight: 300 } },
];

export default fontPairs;
