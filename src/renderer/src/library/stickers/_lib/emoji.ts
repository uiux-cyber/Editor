import type { EmojiStickerDef, StickerCategory } from '../../types';

/**
 * Compact builders for the emoji catalogue. They live in `_lib/` because the library registry
 * imports the default export of every `stickers/*.ts` file; helpers must stay out of that glob.
 *
 * The id is derived from the code points (`emoji-1f600`, `emoji-2764-fe0f`); `keywords` is a
 * space-separated list of lower-case search terms.
 */
export function emoji(char: string, name: string, category: StickerCategory, keywords: string): EmojiStickerDef {
  const cps: string[] = [];
  for (const ch of char) cps.push(ch.codePointAt(0)!.toString(16));
  return {
    id: 'emoji-' + cps.join('-'),
    kind: 'emoji',
    char,
    name,
    category,
    keywords: keywords.split(' ').filter(Boolean),
  };
}

/** Binds a category so the per-category files stay one short line per emoji. */
export const emojiIn =
  (category: StickerCategory) =>
  (char: string, name: string, keywords: string): EmojiStickerDef =>
    emoji(char, name, category, keywords);

const ZWJ = '‍';
const MALE = ZWJ + '♂️';
const FEMALE = ZWJ + '♀️';

/**
 * A person emoji plus its "man" and "woman" forms (base + ZWJ + gender sign), e.g. 🤷 🤷‍♂️ 🤷‍♀️.
 * `name` is the neutral name ("Person Shrugging"); the variants swap the leading "Person".
 */
export function gendered(category: StickerCategory, base: string, name: string, keywords: string): EmojiStickerDef[] {
  const rest = name.replace(/^Person\s+/, '');
  return [
    emoji(base, name, category, keywords),
    emoji(base + MALE, `Man ${rest}`, category, `${keywords} man male guy`),
    emoji(base + FEMALE, `Woman ${rest}`, category, `${keywords} woman female girl`),
  ];
}

/**
 * A profession in its neutral, man and woman forms (person + ZWJ + object), e.g. 🧑‍💻 👨‍💻 👩‍💻.
 */
export function roles(category: StickerCategory, object: string, name: string, keywords: string): EmojiStickerDef[] {
  return [
    emoji('\u{1f9d1}' + ZWJ + object, name, category, keywords),
    emoji('\u{1f468}' + ZWJ + object, `Man ${name}`, category, `${keywords} man male`),
    emoji('\u{1f469}' + ZWJ + object, `Woman ${name}`, category, `${keywords} woman female`),
  ];
}
