import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RELEASES_URL, classifyUpdateError, releaseNotesToText, releasePageUrl } from '@shared/updates';

describe('release notes', () => {
  it('turns GitHub release HTML into plain text', () => {
    const html =
      '<h2>What&#39;s new</h2>\n<ul>\n<li><strong>Editing:</strong> ripple &amp; roll trims</li>\n<li>Auto captions</li>\n</ul>\n<p>Thanks to all <a href="https://example.com">contributors</a>!</p><script>alert(1)</script>';
    expect(releaseNotesToText(html)).toBe("What's new\n\n• Editing: ripple & roll trims\n• Auto captions\n\nThanks to all contributors!");
  });

  it('never passes markup through', () => {
    const text = releaseNotesToText('<img src=x onerror="alert(1)"><b>Bold</b> &lt;i&gt;');
    expect(text).toBe('Bold <i>');
    expect(text).not.toMatch(/onerror|<img|<b>/);
  });

  it('joins notes given per version', () => {
    const text = releaseNotesToText([
      { version: '1.3.0', note: '<p>Newest</p>' },
      { version: '1.2.0', note: '<p>Older</p>' },
    ]);
    expect(text).toBe('1.3.0\n\nNewest\n\n1.2.0\n\nOlder');
  });

  it('handles missing notes and caps very long ones', () => {
    expect(releaseNotesToText(null)).toBe('');
    expect(releaseNotesToText(undefined)).toBe('');
    const long = releaseNotesToText(`<p>${'a'.repeat(5000)}</p>`, 100);
    expect(long.length).toBe(101);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('update errors', () => {
  it('explains the common failures', () => {
    expect(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).code).toBe('offline');
    expect(classifyUpdateError(new Error('getaddrinfo ENOTFOUND github.com')).code).toBe('offline');
    expect(classifyUpdateError(new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/…): HttpError: 404')).code).toBe('unpublished');
    expect(classifyUpdateError(new Error('sha512 checksum mismatch, expected abc, got def')).code).toBe('integrity');
    expect(classifyUpdateError(new Error('HttpError: 403 Forbidden rate limit exceeded')).code).toBe('busy');
    expect(classifyUpdateError(new Error('Something odd')).code).toBe('other');
  });

  it('keeps only a short first line of detail', () => {
    const { detail } = classifyUpdateError(new Error(`${'x'.repeat(300)}\n    at stack line`));
    expect(detail.length).toBe(161);
    expect(detail).not.toContain('stack');
  });
});

describe('release links and publishing config', () => {
  it('points at the public repository', () => {
    expect(releasePageUrl('1.2.0')).toBe(`${RELEASES_URL}/tag/v1.2.0`);
    expect(releasePageUrl('v1.2.0')).toBe(`${RELEASES_URL}/tag/v1.2.0`);
  });

  it('builds update information for the same repository', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const [publish] = pkg.build.publish;
    expect(publish).toMatchObject({ provider: 'github', owner: 'uiux-cyber', repo: 'Editor' });
    expect(RELEASES_URL).toBe(`https://github.com/${publish.owner}/${publish.repo}/releases`);
  });
});
