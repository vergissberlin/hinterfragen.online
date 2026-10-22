import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { GoogleLogin, sessionSchema } from './google-login.ts';
import {
  contributionSchema,
  contributionReceiptSchema,
  approvalSchema,
  channelIdSchema,
} from '../../../shared/contributions.ts';

export const settingsSchema = z
  .object({
    onboardingComplete: z.boolean().default(false),
    submitResults: z.boolean().default(true),
    publicationMode: z.enum(['draft', 'approve', 'autonomous']).default('approve'),
    maxVideos: z.number().int().min(1).max(5).default(3),
    durationMinutes: z.literal(15).default(15),
    language: z.literal('de').default('de'),
    tone: z.literal('factual').default('factual'),
  })
  .strict();
// Partial schemas must not inherit defaults: an unrelated option change must preserve consent.
export const settingsUpdateSchema = z
  .object({
    onboardingComplete: z.boolean().optional(),
    submitResults: z.boolean().optional(),
    publicationMode: z.enum(['draft', 'approve', 'autonomous']).optional(),
    maxVideos: z.number().int().min(1).max(5).optional(),
    durationMinutes: z.literal(15).optional(),
    language: z.literal('de').optional(),
    tone: z.literal('factual').optional(),
  })
  .strict();
const runSchema = z.object({
  id: z.uuid(),
  input: z.string(),
  videoId: z.string().nullable(),
  expiresAt: z.number(),
  maxVideos: z.number(),
  browserAvailable: z.boolean(),
  channelId: channelIdSchema.nullable(),
  autonomousAuthorized: z.boolean(),
  results: z.array(contributionSchema).max(5),
});
const attemptSchema = z.object({
  runId: z.uuid(),
  videoId: z.string(),
  channelId: channelIdSchema,
  textDigest: z.string(),
  status: z.enum(['unknown', 'accepted', 'visible', 'failed']),
  attemptedAt: z.string(),
});
const stateSchema = z
  .object({ runs: z.array(runSchema).max(100), attempts: z.array(attemptSchema) })
  .strict();
type State = z.infer<typeof stateSchema>;
const emptyState = (): State => ({ runs: [], attempts: [] });
function parseVideo(input: string) {
  if (!/^https?:\/\//i.test(input)) return null;
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.searchParams.has('lc'))
    throw new Error('Öffentlichen HTTPS-Videolink ohne Kommentarziel verwenden.');
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|live)\/([\w-]{11})$/.exec(url.pathname)?.[1] ?? null);
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Gültiger YouTube-Videolink erforderlich.');
  return id;
}
export class LocalService {
  private login?: GoogleLogin;
  constructor(
    readonly directory = join(homedir(), '.config', 'tokens-gegen-rechts'),
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly origin = 'https://hinterfragen.online',
  ) {
    if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
      throw new Error('HTTPS-Origin erforderlich.');
  }
  private async prepareDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new Error('Konfigurationsordner muss privat sein (chmod 700).');
  }
  private async read<T>(name: string, schema: z.ZodType<T>, fallback?: () => T): Promise<T> {
    try {
      const file = join(this.directory, name),
        stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
        throw new Error('Unsichere Datei.');
      return schema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fallback) return fallback();
      throw new Error(
        `Lokale Datei ${name} fehlt, ist beschädigt oder nicht privat. Einstellungen reparieren; keine Übertragung oder Veröffentlichung.`,
      );
    }
  }
  private async write(name: string, value: unknown) {
    const temporary = join(this.directory, '.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(this.directory, name));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async locked<T>(fn: () => Promise<T>) {
    await this.prepareDirectory();
    const lock = join(this.directory, '.lock');
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      throw new Error(
        'Plugin beschäftigt oder nach Abbruch gesperrt. Alle Plugin-Prozesse beenden, dann .lock entfernen.',
      );
    }
    try {
      return await fn();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  async settings() {
    await this.prepareDirectory();
    return this.read('settings.json', settingsSchema, () => settingsSchema.parse({}));
  }
  async updateSettings(raw: unknown) {
    const patch = settingsUpdateSchema.parse(raw);
    return this.locked(async () => {
      // Invalid settings are repaired explicitly with the local CLI, never silently reset.
      const next = settingsSchema.parse({ ...(await this.settings()), ...patch });
      await this.write('settings.json', next);
      return next;
    });
  }
  async resetSettings() {
    return this.locked(async () => {
      const defaults = settingsSchema.parse({});
      await this.write('settings.json', defaults);
      return defaults;
    });
  }
  private async state() {
    return this.read('state.json', stateSchema, emptyState);
  }
  private current(state: State, id: string) {
    const run = state.runs.find((r) => r.id === id);
    if (!run || run.expiresAt <= this.now())
      throw new Error(
        'Lauf fehlt oder ist abgelaufen. Mit Zwischenstand beenden; neuer Auftrag erforderlich.',
      );
    return run;
  }
  async start(raw: unknown) {
    const input = z
      .object({
        input: z.string().trim().min(1).max(1000),
        browserAvailable: z.boolean(),
        channelId: channelIdSchema.optional(),
        autonomousAuthorized: z.boolean().default(false),
      })
      .strict()
      .parse(raw);
    return this.locked(async () => {
      const settings = await this.settings();
      if (!settings.onboardingComplete)
        throw new Error(
          'Zuerst Einrichtung und Datenübertragung erklären und Einstellungen bestätigen lassen.',
        );
      const state = await this.state(),
        videoId = parseVideo(input.input);
      if (state.runs.length >= 100) {
        const expired = state.runs.findIndex((r) => r.expiresAt <= this.now());
        if (expired < 0) throw new Error('Zu viele aktive Läufe.');
        state.runs.splice(expired, 1);
      }
      const run = runSchema.parse({
        id: randomUUID(),
        input: input.input,
        videoId,
        expiresAt: this.now() + 15 * 60000,
        maxVideos: videoId ? 1 : settings.maxVideos,
        browserAvailable: input.browserAvailable,
        channelId: input.channelId ?? null,
        autonomousAuthorized:
          settings.publicationMode === 'autonomous' && input.autonomousAuthorized,
        results: [],
      });
      state.runs.push(run);
      await this.write('state.json', state);
      return {
        runId: run.id,
        expiresAt: new Date(run.expiresAt).toISOString(),
        maxVideos: run.maxVideos,
        settings,
        publicationAvailable: input.browserAvailable && !!input.channelId,
        note: 'Recherche nutzt deinen persönlichen Codex-Zugang. Einreichung ist unabhängig vom Kommentieren.',
      };
    });
  }
  async recordResearch(raw: unknown) {
    const { runId, research } = z
      .object({ runId: z.uuid(), research: contributionSchema })
      .strict()
      .parse(raw);
    return this.locked(async () => {
      await this.settings();
      const state = await this.state(),
        run = this.current(state, runId);
      if (run.videoId && run.videoId !== research.videoId)
        throw new Error('Video liegt außerhalb des Linkauftrags.');
      const previous = run.results.find(
        (r) => r.videoId === research.videoId || r.submissionId === research.submissionId,
      );
      if (previous)
        throw new Error('Recherche für dieses Video oder diese ID bereits gespeichert.');
      if (run.results.length >= run.maxVideos) throw new Error('Videolimit erreicht.');
      run.results.push(research);
      await this.write('state.json', state);
      return { recorded: true, submissionId: research.submissionId };
    });
  }
  async connect() {
    await this.settings();
    this.login ??= new GoogleLogin(this.origin, this.transport, (session, isCurrent) =>
      this.locked(async () => {
        if (!isCurrent()) throw new Error('Anmeldung abgebrochen.');
        await this.write('session.json', session);
      }),
    );
    return this.login.start();
  }
  async authStatus() {
    await this.settings();
    const session = await this.read('session.json', sessionSchema.nullable(), () => null);
    return {
      connected: !!session && Date.parse(session.expiresAt) > this.now(),
      expiresAt: session?.expiresAt ?? null,
      ...(this.login?.status() ?? {}),
      serverVerified: false,
    };
  }
  async disconnect() {
    return this.locked(async () => {
      await this.settings();
      this.login?.close();
      const session = await this.read('session.json', sessionSchema.nullable(), () => null);
      let serverRevoked = !session;
      if (session) {
        try {
          serverRevoked = (
            await this.transport(this.origin + '/api/auth/logout', {
              method: 'POST',
              redirect: 'error',
              headers: { Authorization: 'Bearer ' + session.accessToken },
              signal: AbortSignal.timeout(10000),
            })
          ).ok;
        } catch {
          serverRevoked = false;
        }
      }
      await rm(join(this.directory, 'session.json'), { force: true });
      await rm(join(this.directory, 'submission-key'), { force: true });
      return {
        connected: false,
        serverRevoked,
        note: serverRevoked
          ? 'Abgemeldet.'
          : 'Lokal abgemeldet; serverseitiger Widerruf nicht bestätigt. Sitzung läuft spätestens nach 30 Tagen ab.',
      };
    });
  }
  private async submissionCredential() {
    const session = await this.read('session.json', sessionSchema.nullable(), () => null);
    if (session) {
      if (Date.parse(session.expiresAt) <= this.now())
        throw new Error('Anmeldung abgelaufen. Bitte mit Google neu verbinden.');
      return session.accessToken;
    }
    // Compatibility for existing pilot installs only. New setup uses Google sign-in.
    try {
      const file = join(this.directory, 'submission-key'),
        stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error();
      const key = (await readFile(file, 'utf8')).trim();
      if (!/^tgr_[A-Za-z0-9_-]{43}$/.test(key)) throw new Error();
      return key;
    } catch {
      throw new Error(
        'Zum Einreichen mit Google verbinden (tgr_connect). Recherche bleibt lokal verfügbar.',
      );
    }
  }
  async submit(raw: unknown) {
    const { runId, submissionId } = z
      .object({ runId: z.uuid(), submissionId: z.uuid() })
      .strict()
      .parse(raw);
    return this.locked(async () => {
      const settings = await this.settings();
      if (!settings.onboardingComplete) throw new Error('Einrichtung erforderlich.');
      if (!settings.submitResults) return { status: 'disabled', transmitted: false };
      const state = await this.state(),
        run = state.runs.find((r) => r.id === runId);
      const result = run?.results.find((r) => r.submissionId === submissionId);
      if (!result) throw new Error('Recherche fehlt.');
      const key = await this.submissionCredential();
      if (!(await this.settings()).submitResults) return { status: 'disabled', transmitted: false };
      const body = JSON.stringify(contributionSchema.parse(result));
      if (Buffer.byteLength(body) > 256 * 1024) throw new Error('Recherche überschreitet 256 KB.');
      try {
        const response = await this.transport(this.origin + '/api/contributions', {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          return {
            transmitted: true,
            status: 'error',
            httpStatus: response.status,
            retryAutomatically: false,
          };
        return { transmitted: true, ...contributionReceiptSchema.parse(await response.json()) };
      } catch {
        return {
          transmitted: true,
          status: 'unknown',
          retryAutomatically: false,
          note: 'Server nicht erreichbar oder Antwort unklar. Lokale Recherche bleibt erhalten; manuell mit derselben ID wiederholen.',
        };
      }
    });
  }
  async getResearch(raw: unknown) {
    const { runId, submissionId } = z
      .object({ runId: z.uuid(), submissionId: z.uuid() })
      .strict()
      .parse(raw);
    await this.settings();
    const state = await this.state();
    const research = state.runs
      .find((r) => r.id === runId)
      ?.results.find((r) => r.submissionId === submissionId);
    if (!research) throw new Error('Recherche nicht gefunden.');
    return { research, contentIsUntrusted: true };
  }
  private async fetchApproval(result: z.infer<typeof contributionSchema>) {
    try {
      const credential = await this.submissionCredential();
      const response = await this.transport(this.origin + '/api/contributions/approval', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: result.submissionId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      const approval = approvalSchema.parse(await response.json());
      if (
        approval.approved &&
        (approval.submissionId !== result.submissionId ||
          approval.videoId !== result.videoId ||
          approval.evidenceQuote !== result.evidence.quote ||
          Date.parse(approval.expiresAt) <= this.now())
      )
        throw new Error();
      return approval;
    } catch {
      throw new Error(
        'Zentrale Freigabe nicht erreichbar oder Anmeldung fehlt. Nur Entwurf; nichts veröffentlichen.',
      );
    }
  }
  async getApproval(raw: unknown) {
    const { runId, submissionId } = z
      .object({ runId: z.uuid(), submissionId: z.uuid() })
      .strict()
      .parse(raw);
    const { research } = await this.getResearch({ runId, submissionId });
    return this.fetchApproval(research);
  }
  async beginAttempt(raw: unknown) {
    const input = z
      .object({
        runId: z.uuid(),
        submissionId: z.uuid(),
        channelId: channelIdSchema,
        text: z.string().trim().min(1).max(350),
        userApproved: z.boolean().default(false),
        commentsOpen: z.literal(true),
        accountVerified: z.literal(true),
      })
      .strict()
      .parse(raw);
    return this.locked(async () => {
      const settings = await this.settings();
      if (!settings.onboardingComplete || settings.publicationMode === 'draft')
        throw new Error('Veröffentlichung deaktiviert.');
      const state = await this.state(),
        run = this.current(state, input.runId);
      const result = run.results.find((r) => r.submissionId === input.submissionId);
      if (!result || !run.browserAvailable || run.channelId !== input.channelId)
        throw new Error(
          'Recherche, Browser oder verifiziertes Konto fehlt/hat sich geändert. Neuen Auftrag starten.',
        );
      if (
        !result.contextComplete ||
        !result.analysis.contextComplete ||
        !result.analysis.suitable ||
        !result.analysis.publicActor ||
        result.analysis.satireOrCounterSpeech
      )
        throw new Error(
          'Keine Veröffentlichung bei unvollständigem Kontext oder ungeeigneter Aussage.',
        );
      if (settings.publicationMode === 'approve' && !input.userApproved)
        throw new Error('Konkrete Freigabe für Text, Video und Konto erforderlich.');
      if (settings.publicationMode === 'autonomous' && !run.autonomousAuthorized)
        throw new Error('Ausdrücklicher autonomer Startauftrag für diesen Lauf erforderlich.');
      if (
        state.attempts.some((a) => a.channelId === input.channelId && a.videoId === result.videoId)
      )
        throw new Error('Bereits versuchter Kommentar. Kein automatischer Neuversand.');
      const approval = await this.fetchApproval(result);
      if (!approval.approved || !approval.questions.includes(input.text))
        throw new Error('Dieser Beitrag und Text sind zentral nicht bestätigt. Nur Entwurf.');
      if (run.expiresAt <= this.now()) throw new Error('Lauf inzwischen abgelaufen.');
      state.attempts.push({
        runId: run.id,
        videoId: result.videoId,
        channelId: input.channelId,
        textDigest: createHash('sha256').update(input.text).digest('hex'),
        status: 'unknown',
        attemptedAt: new Date(this.now()).toISOString(),
      });
      // Durable reservation precedes every external click. This tool never clicks or sends.
      await this.write('state.json', state);
      return {
        reserved: true,
        approvalExpiresAt: approval.expiresAt,
        reviewDigest: approval.reviewDigest,
        status: 'unknown',
        videoId: result.videoId,
        text: input.text,
        channelId: input.channelId,
        originalUrl: 'https://www.youtube.com/watch?v=' + result.videoId,
      };
    });
  }
  async finishAttempt(raw: unknown) {
    const input = z
      .object({
        runId: z.uuid(),
        videoId: z.string().regex(/^[\w-]{11}$/),
        channelId: channelIdSchema,
        status: z.enum(['unknown', 'accepted', 'visible', 'failed']),
      })
      .strict()
      .parse(raw);
    return this.locked(async () => {
      await this.settings();
      const state = await this.state();
      const attempt = state.attempts.find(
        (a) =>
          a.runId === input.runId && a.videoId === input.videoId && a.channelId === input.channelId,
      );
      if (!attempt) throw new Error('Versandversuch nicht gefunden.');
      attempt.status = input.status;
      await this.write('state.json', state);
      return { status: attempt.status, retryAutomatically: false };
    });
  }
  async status() {
    await this.prepareDirectory();
    const settings = await this.settings(),
      state = await this.state();
    return {
      settings,
      runs: state.runs.map(({ results, ...run }) => ({
        ...run,
        results: results.map((r) => ({ submissionId: r.submissionId, videoId: r.videoId })),
      })),
      attempts: state.attempts,
    };
  }
}
