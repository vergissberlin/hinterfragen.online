import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalService } from '../plugins/tokens-gegen-rechts/src/service.ts';
import { research } from './plugin-fixtures.ts';
let dir: string, service: LocalService, now: number;
const channelId = 'UC' + 'a'.repeat(22);
const transport = vi.fn<typeof fetch>();
const approved = new Map<string, ReturnType<typeof research>>();
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tgr-local-'));
  now = Date.now();
  transport.mockReset();
  approved.clear();
  transport.mockImplementation(async (url, options) => {
    if (!String(url).endsWith('/api/contributions/approval'))
      throw new Error('Unexpected endpoint');
    const id = JSON.parse(String(options?.body)).submissionId;
    const result = approved.get(id);
    return new Response(
      JSON.stringify(
        result
          ? {
              approved: true,
              submissionId: id,
              videoId: result.videoId,
              evidenceQuote: result.evidence.quote,
              questions: result.analysis.questions,
              expiresAt: new Date(now + 30000).toISOString(),
              reviewDigest: 'a'.repeat(64),
            }
          : { approved: false, reason: 'review_pending' },
      ),
    );
  });
  service = new LocalService(dir, transport, () => now);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function setup(
  mode: 'draft' | 'approve' | 'autonomous' = 'approve',
  browserAvailable = true,
  autonomousAuthorized = false,
) {
  await service.updateSettings({ onboardingComplete: true, publicationMode: mode });
  const run = await service.start({
    input: 'Demokratie',
    browserAvailable,
    channelId,
    autonomousAuthorized,
  });
  const result = research();
  approved.set(result.submissionId, result);
  await writeFile(join(dir, 'submission-key'), 'tgr_' + 'a'.repeat(43), { mode: 0o600 });
  await service.recordResearch({ runId: run.runId, research: result });
  return { runId: run.runId, submissionId: result.submissionId, result };
}
function attempt(
  run: { runId: string; submissionId: string; result: ReturnType<typeof research> },
  extra = {},
) {
  return {
    runId: run.runId,
    submissionId: run.submissionId,
    channelId,
    text: run.result.analysis.questions[0],
    commentsOpen: true,
    accountVerified: true,
    userApproved: true,
    ...extra,
  };
}
describe('Persönliche Optionen und Recherche', () => {
  it('zeigt Defaults, benötigt bestätigte Einrichtung und erhält Optionen nach Neustart', async () => {
    expect(await service.settings()).toMatchObject({
      submitResults: true,
      publicationMode: 'approve',
      maxVideos: 3,
    });
    await expect(service.start({ input: 'Thema', browserAvailable: false })).rejects.toThrow(
      'Einrichtung',
    );
    await service.updateSettings({ onboardingComplete: true, submitResults: false, maxVideos: 2 });
    expect(await new LocalService(dir).settings()).toMatchObject({
      submitResults: false,
      maxVideos: 2,
    });
  });
  it('überträgt nach Abschalten auch gespeicherte Ergebnisse und Wiederholungen nicht', async () => {
    const run = await setup();
    await writeFile(join(dir, 'submission-key'), 'tgr_' + 'a'.repeat(43), { mode: 0o600 });
    await service.updateSettings({ submitResults: false });
    expect(
      await service.submit({ runId: run.runId, submissionId: run.submissionId }),
    ).toMatchObject({ transmitted: false, status: 'disabled' });
    expect(
      await new LocalService(dir, transport).submit({
        runId: run.runId,
        submissionId: run.submissionId,
      }),
    ).toMatchObject({ transmitted: false });
    expect(transport).not.toHaveBeenCalled();
  });
  it('sendet ausschließlich den gespeicherten Vertrag und hält Anmeldedaten aus Ergebnissen heraus', async () => {
    const run = await setup();
    const key = 'tgr_' + 'a'.repeat(43);
    await writeFile(join(dir, 'submission-key'), key, { mode: 0o600 });
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({ submissionId: run.submissionId, status: 'review', duplicate: false }),
      ),
    );
    expect(
      await service.submit({ runId: run.runId, submissionId: run.submissionId }),
    ).toMatchObject({ status: 'review', transmitted: true });
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://hinterfragen.online/api/contributions');
    expect(JSON.parse(String(options?.body))).toEqual(run.result);
    expect(options?.redirect).toBe('error');
    expect(JSON.stringify(await service.status())).not.toContain(key);
    await expect(
      service.recordResearch({
        runId: run.runId,
        research: { ...research(), privateChat: 'secret' },
      }),
    ).rejects.toThrow();
  });
  it('hält Recherche bei Serverausfall lokal abrufbar und wiederholt nie selbst', async () => {
    const run = await setup();
    await writeFile(join(dir, 'submission-key'), 'tgr_' + 'a'.repeat(43), { mode: 0o600 });
    transport.mockRejectedValue(new Error('private upstream error'));
    expect(
      await service.submit({ runId: run.runId, submissionId: run.submissionId }),
    ).toMatchObject({ status: 'unknown', retryAutomatically: false });
    expect(transport).toHaveBeenCalledTimes(1);
    now += 16 * 60000;
    expect(
      (await service.getResearch({ runId: run.runId, submissionId: run.submissionId })).research,
    ).toEqual(run.result);
  });
  it('stoppt bei beschädigten oder unsicheren Dateien und erhält Versandhistorie beim Reset', async () => {
    const run = await setup();
    await service.beginAttempt(attempt(run));
    transport.mockClear();
    await writeFile(join(dir, 'settings.json'), '{broken');
    await expect(
      service.submit({ runId: run.runId, submissionId: run.submissionId }),
    ).rejects.toThrow('beschädigt');
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('beschädigt');
    expect(transport).not.toHaveBeenCalled();
    await service.resetSettings();
    expect((await service.status()).attempts).toHaveLength(1);
    await chmod(join(dir, 'settings.json'), 0o644);
    await expect(service.settings()).rejects.toThrow('nicht privat');
  });
  it('begrenzt Linkaufträge, Videomenge und Laufzeit', async () => {
    await service.updateSettings({ onboardingComplete: true, maxVideos: 1 });
    const run = await service.start({
      input: 'https://youtu.be/abcdefghijk',
      browserAvailable: false,
    });
    expect(run.maxVideos).toBe(1);
    await expect(
      service.recordResearch({ runId: run.runId, research: research({ videoId: '12345678901' }) }),
    ).rejects.toThrow('außerhalb');
    await service.recordResearch({ runId: run.runId, research: research() });
    await expect(
      service.recordResearch({ runId: run.runId, research: research() }),
    ).rejects.toThrow('bereits');
    now += 15 * 60000;
    await expect(
      service.recordResearch({ runId: run.runId, research: research() }),
    ).rejects.toThrow('abgelaufen');
  });
});
describe('Dauerhafte Veröffentlichungsvorbereitung ohne Browseraktion', () => {
  it('blockiert ungeprüfte Inhalte, geänderte Texte und Ausfälle der zentralen Freigabe', async () => {
    const run = await setup();
    approved.clear();
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('nicht bestätigt');
    approved.set(run.submissionId, run.result);
    await expect(service.beginAttempt(attempt(run, { text: 'Ein anderer Text?' }))).rejects.toThrow(
      'nicht bestätigt',
    );
    transport.mockRejectedValue(new Error('offline'));
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('nicht erreichbar');
    expect((await service.status()).attempts).toHaveLength(0);
  });
  it('zeigt redaktionell geänderte Fragen und akzeptiert nur den neu freigegebenen Text', async () => {
    const run = await setup();
    const corrected = structuredClone(run.result);
    corrected.analysis.questions[0] = 'Woher weißt du das?';
    approved.set(run.submissionId, corrected);
    expect(
      await service.getApproval({ runId: run.runId, submissionId: run.submissionId }),
    ).toMatchObject({ approved: true, questions: corrected.analysis.questions });
    expect(
      await service.beginAttempt(attempt(run, { text: corrected.analysis.questions[0] })),
    ).toMatchObject({ reserved: true });
  });
  it('blockiert Entwurfsmodus und fehlende konkrete Freigabe', async () => {
    const run = await setup('draft');
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('deaktiviert');
    await service.updateSettings({ publicationMode: 'approve' });
    await expect(service.beginAttempt(attempt(run, { userApproved: false }))).rejects.toThrow(
      'Freigabe',
    );
  });
  it('benötigt zusätzlich zur autonomen Einstellung einen Laufauftrag', async () => {
    const run = await setup('autonomous');
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('Startauftrag');
    const authorized = await setup('autonomous', true, true);
    expect(await service.beginAttempt(attempt(authorized, { userApproved: false }))).toMatchObject({
      reserved: true,
      status: 'unknown',
    });
    expect(
      transport.mock.calls.every(([url]) => String(url).endsWith('/api/contributions/approval')),
    ).toBe(true);
  });
  it('blockiert fehlenden Browser, Kontoänderung und geschlossene Kommentare', async () => {
    const run = await setup('approve', false);
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('Browser');
    const enabled = await setup();
    await expect(
      service.beginAttempt(attempt(enabled, { channelId: 'UC' + 'b'.repeat(22) })),
    ).rejects.toThrow('Konto');
    await expect(service.beginAttempt(attempt(enabled, { commentsOpen: false }))).rejects.toThrow();
  });
  it.each(['context', 'satire', 'actor', 'suitable'])(
    'blockiert ungeeignete Recherche: %s',
    async (kind) => {
      await service.updateSettings({ onboardingComplete: true });
      const run = await service.start({ input: 'Thema', browserAvailable: true, channelId });
      const result = research();
      if (kind === 'context') result.contextComplete = false;
      if (kind === 'satire') result.analysis.satireOrCounterSpeech = true;
      if (kind === 'actor') result.analysis.publicActor = false;
      if (kind === 'suitable') result.analysis.suitable = false;
      await service.recordResearch({ runId: run.runId, research: result });
      await expect(
        service.beginAttempt(
          attempt({ runId: run.runId, submissionId: result.submissionId, result }),
        ),
      ).rejects.toThrow('unvollständigem');
    },
  );
  it('reserviert vor Versand und verhindert Doppelversand nach Neustart und Fehlerstatus', async () => {
    const run = await setup();
    expect(await service.beginAttempt(attempt(run))).toMatchObject({ reserved: true });
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).attempts[0].status).toBe(
      'unknown',
    );
    service = new LocalService(dir, transport, () => now);
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('Bereits');
    await service.finishAttempt({
      runId: run.runId,
      videoId: run.result.videoId,
      channelId,
      status: 'failed',
    });
    await expect(service.beginAttempt(attempt(run))).rejects.toThrow('Bereits');
  });
  it('verhindert parallele Reservierung auch über Serviceinstanzen', async () => {
    const run = await setup();
    const another = new LocalService(dir, transport, () => now);
    const results = await Promise.allSettled([
      service.beginAttempt(attempt(run)),
      another.beginAttempt(attempt(run)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
