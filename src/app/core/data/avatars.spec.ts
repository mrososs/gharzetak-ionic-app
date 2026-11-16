import { describe, expect, it } from 'vitest';
import { AVATARS, AVATAR_IDS, DEFAULT_AVATAR, avatarSrc, isAvatarId, toAvatarId } from './avatars';

describe('avatar catalog', () => {
  it('ships at least six stable ids with bilingual metadata and a relative asset path', () => {
    expect(AVATAR_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of AVATAR_IDS) {
      expect(AVATARS[id].id).toBe(id);
      expect(AVATARS[id].ar.length).toBeGreaterThan(0);
      expect(AVATARS[id].en.length).toBeGreaterThan(0);
      expect(avatarSrc(id)).toBe(`assets/avatars/${id}.svg`);
    }
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR);
  });

  it('only accepts known ids; paths, URLs and junk are rejected', () => {
    expect(toAvatarId('bunny')).toBe('bunny');
    for (const bad of ['../x.svg', 'assets/avatars/bunny.svg', 'https://evil.test/a.png', 'BUNNY', '', null, undefined, 3, {}]) {
      expect(isAvatarId(bad)).toBe(false);
      expect(toAvatarId(bad)).toBeNull();
    }
  });
});
