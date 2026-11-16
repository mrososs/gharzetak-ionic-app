/** YouTube link helpers. No scraping, no downloading — only official watch/embed URLs. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
        id = m ? m[2] : null;
      }
    }
    return id && ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Official privacy-enhanced embed URL starting at `start` seconds. */
export function youtubeEmbedUrl(id: string, start = 0): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${start > 0 ? '&start=' + Math.floor(start) : ''}`;
}

/** Watch URL that opens the video at a timestamp in YouTube. */
export function youtubeWatchUrl(id: string, start = 0): string {
  return `https://www.youtube.com/watch?v=${id}${start > 0 ? '&t=' + Math.floor(start) + 's' : ''}`;
}
