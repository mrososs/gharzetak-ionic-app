import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../src/env';
import { sendMail } from '../src/services/mailer';

const msg = { to: 'person@example.com', subject: 'Reset your Gharzetak password', text: 'x', link: 'https://api.example/reset?token=SECRET-ONE-TIME-TOKEN' };
const env = (name: string) => ({ ENVIRONMENT: name }) as unknown as AppEnv;

describe('mailer logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never writes the one-time link or the recipient to hosted (staging) logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await sendMail(env('staging'), msg);
    const printed = log.mock.calls.flat().join(' ');
    expect(printed).not.toContain('SECRET-ONE-TIME-TOKEN');
    expect(printed).not.toContain('person@example.com');
    expect(printed).toContain('withheld');
  });

  it('still prints the link for local development so a developer can click it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await sendMail(env('development'), msg);
    expect(log.mock.calls.flat().join(' ')).toContain('SECRET-ONE-TIME-TOKEN');
  });

  it('fails loudly in production instead of silently dropping the mail', async () => {
    await expect(sendMail(env('production'), msg)).rejects.toThrow(/No email provider/);
  });
});
