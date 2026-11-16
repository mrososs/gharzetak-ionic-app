import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_IDS, avatarSrc } from '../src/app/core/data/avatars';

/** No server needed: guards the three copies of the avatar id list (app, API validator, D1 CHECK) and the bundled artwork. */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('avatar ids stay in sync across app, API and D1', () => {
  it('API validator, drizzle schema and migration list exactly the app ids', () => {
    const list = `[${AVATAR_IDS.map((i) => `'${i}'`).join(', ')}]`;
    const sqlList = AVATAR_IDS.map((i) => `'${i}'`).join(',');
    expect(read('apps/api/src/validators.ts')).toContain(`AVATAR_IDS = ${list} as const`);
    expect(read('apps/api/src/db/schema.ts')).toContain(`avatar_id in (${sqlList})`);
    expect(read('apps/api/drizzle/0001_profile_avatar.sql')).toContain(`avatar_id in (${sqlList})`);
  });

  it('every id has a bundled, lightweight SVG (no per-avatar network or R2 upload)', () => {
    for (const id of AVATAR_IDS) {
      const file = resolve(root, 'public', avatarSrc(id));
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).length).toBeLessThan(12 * 1024);
    }
  });

  it('the migration is additive: one ALTER ... ADD, no DROP/DELETE/rebuild', () => {
    const sql = read('apps/api/drizzle/0001_profile_avatar.sql')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(sql).toMatch(/ALTER TABLE `profiles` ADD `avatar_id`/);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|CREATE TABLE)\b/i);
  });
});
