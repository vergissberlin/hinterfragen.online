import type { PublicPost } from './contracts.ts';
export const youtubeScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
type TokenResponse = { access_token?: string; expires_in?: number; error?: string; scope?: string };
type Identity = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: () => void;
      }) => { requestAccessToken: (options: { prompt: string }) => void };
      hasGrantedAllScopes: (response: TokenResponse, scope: string) => boolean;
      revoke: (token: string, callback: () => void) => void;
    };
  };
};
export function commentBody(post: PublicPost, text: string) {
  if (
    post.demo ||
    !/^[\w-]{11}$/.test(post.videoId) ||
    !('channelId' in post) ||
    !/^UC[\w-]{22}$/.test(String(post.channelId))
  )
    throw new Error('missing_target');
  if (!text.trim() || text.length > 600) throw new Error('invalid_text');
  return {
    snippet: {
      channelId: post.channelId,
      videoId: post.videoId,
      topLevelComment: { snippet: { textOriginal: text.trim() } },
    },
  };
}
export function setupYoutubePublishing(actions: {
  current: () => PublicPost | undefined;
  question: () => string;
  feedback: (text: string) => void;
}) {
  const clientId = import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID;
  const button = document.getElementById('youtube-publish') as HTMLButtonElement;
  const dialog = document.getElementById('publish-dialog') as HTMLDialogElement;
  const approve = document.getElementById('publish-approve') as HTMLButtonElement;
  const connect = document.getElementById('youtube-connect') as HTMLButtonElement;
  const disconnect = document.getElementById('youtube-disconnect') as HTMLButtonElement;
  const state = document.getElementById('publish-state')!;
  let token: string | undefined,
    expires = 0,
    busy = false;
  let pending: { post: PublicPost; text: string } | undefined;
  const attempts = new Set<string>();
  let identity: Identity | undefined;
  const status = (text: string) => {
    state.textContent = text;
  };
  async function loadIdentity() {
    if (!clientId || identity) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error('identity_unavailable'));
      };
      document.head.append(script);
    });
    identity = (window as Window & { google?: Identity }).google;
    if (!identity) throw new Error('identity_unavailable');
    connect.disabled = false;
    status('Bereit zum Verbinden. Google wird erst nach deinem Klick geöffnet.');
  }
  function request() {
    const post = actions.current(),
      text = actions.question();
    if (!post || post.demo)
      return { status: 'unavailable', reason: 'Kein echter, gültiger Beitrag ausgewählt.' };
    if (!text) return { status: 'unavailable', reason: 'Bitte zuerst eine Frage vorbereiten.' };
    if (!clientId)
      return {
        status: 'not_configured',
        originalUrl: `https://www.youtube.com/watch?v=${post.videoId}`,
        question: text,
        reason:
          'YouTube-Verbindung ist nicht eingerichtet. Frage kopieren und selbst auf YouTube posten oder einen eigenen Browser-Agenten auf YouTube beauftragen.',
      };
    if (busy) return { status: 'busy' };
    pending = { post: structuredClone(post), text };
    document.getElementById('publish-preview')!.textContent = text;
    document.getElementById('publish-target')!.textContent = `${post.title} · ${post.channel}`;
    approve.disabled = !token || expires <= Date.now();
    status(
      token
        ? 'Prüfe Ziel und Text. Dein Klick veröffentlicht diesen einen Kommentar.'
        : 'Zum Veröffentlichen musst du dein YouTube-Konto verbinden.',
    );
    if (!dialog.open) dialog.showModal();
    // Tool invocation does not load Google; an actual click on the connect button does.
    connect.disabled = false;
    return { status: 'awaiting_user_approval', videoId: post.videoId, question: text };
  }
  if (clientId) button.hidden = false;
  button.addEventListener('click', () => {
    const result = request();
    if ('reason' in result && result.reason) actions.feedback(result.reason);
  });
  document.getElementById('publish-cancel')!.addEventListener('click', () => {
    if (!busy) {
      pending = undefined;
      dialog.close();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
    else pending = undefined;
  });
  connect.addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    if (!identity) {
      connect.disabled = true;
      status('Google-Verbindung wird geladen.');
      try {
        await loadIdentity();
        status('Google geladen. Klicke erneut auf „YouTube verbinden“, um dein Konto zu wählen.');
      } catch {
        connect.disabled = false;
        status(
          'Google konnte nicht geladen werden. Kopieren und auf YouTube öffnen funktioniert weiterhin.',
        );
      }
      return;
    }
    const client = identity.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: youtubeScope,
      callback: (response) => {
        if (
          !response.access_token ||
          !identity!.accounts.oauth2.hasGrantedAllScopes(response, youtubeScope)
        ) {
          status('Keine ausreichende YouTube-Berechtigung erteilt.');
          return;
        }
        token = response.access_token;
        expires = Date.now() + (response.expires_in ?? 0) * 1000;
        approve.disabled = false;
        disconnect.hidden = false;
        status('YouTube verbunden. Prüfe jetzt Ziel und Text vor dem Veröffentlichen.');
      },
      error_callback: () => status('Verbindung abgebrochen. Es wurde nichts veröffentlicht.'),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  disconnect.addEventListener('click', (event) => {
    if (!event.isTrusted || busy) return;
    if (token) identity?.accounts.oauth2.revoke(token, () => {});
    token = undefined;
    expires = 0;
    approve.disabled = true;
    disconnect.hidden = true;
    status('YouTube-Verbindung getrennt.');
  });
  approve.addEventListener('click', async (event) => {
    // WebMCP can request the dialog, never authorize a write on the person's behalf.
    if (!event.isTrusted || !pending || !token || busy || expires <= Date.now()) return;
    const { post, text } = pending;
    if (Date.parse(post.expiresAt) <= Date.now()) {
      status('Die Beitragsprüfung ist abgelaufen. Bitte neu laden.');
      return;
    }
    const key = `${post.videoId}:${text}`;
    if (attempts.has(key)) {
      status(
        'Dieser Versand wurde bereits versucht. Prüfe zuerst auf YouTube, ob der Kommentar angekommen ist.',
      );
      return;
    }
    let body;
    try {
      body = commentBody(post, text);
    } catch {
      status('Ziel oder Frage ist ungültig.');
      return;
    }
    busy = true;
    approve.disabled = true;
    status('Kommentar wird an YouTube gesendet …');
    try {
      const availability = await fetch('/data/runtime.json', {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      });
      const runtime = availability.ok ? await availability.json() : null;
      if (!runtime?.commentingEnabled || !(Date.parse(runtime.expiresAt) > Date.now())) {
        status('Direktes Veröffentlichen ist vorübergehend pausiert.');
        approve.disabled = false;
        return;
      }
      const catalogResponse = await fetch('/data/catalog.json', {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      });
      const catalog = catalogResponse.ok ? await catalogResponse.json() : null;
      if (
        !catalog ||
        catalog.demo ||
        !Array.isArray(catalog.posts) ||
        !catalog.posts.some(
          (p: PublicPost) =>
            p.id === post.id &&
            p.videoId === post.videoId &&
            !p.demo &&
            Date.parse(p.expiresAt) > Date.now() &&
            p.evidence?.quote === post.evidence.quote,
        )
      ) {
        status('Der Beitrag ist nicht mehr aktuell freigegeben. Bitte neu laden.');
        return;
      }
      const liveResponse = await fetch(
        '/api/commenting-status?postId=' + encodeURIComponent(post.id),
        {
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(5000),
        },
      );
      const live = liveResponse.ok ? await liveResponse.json() : null;
      if (
        !live?.enabled ||
        live.videoId !== post.videoId ||
        live.evidenceQuote !== post.evidence.quote
      ) {
        status('Die aktuelle Veröffentlichungsfreigabe fehlt. Es wurde nichts gesendet.');
        return;
      }
      attempts.add(key);
      const response = await fetch(
        'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
        {
          method: 'POST',
          credentials: 'omit',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok) {
        status(
          'YouTube hat die Veröffentlichung nicht bestätigt. Prüfe Berechtigung, Kommentare und dein Konto auf YouTube. Es erfolgt kein automatischer Neuversand.',
        );
        return;
      }
      const data = await response.json();
      if (!data.id) {
        status('Unklare Antwort. Prüfe zuerst auf YouTube, ob der Kommentar angekommen ist.');
        return;
      }
      status('YouTube hat den Kommentar angenommen. Sichtbarkeit kann von Moderation abhängen.');
      actions.feedback('Kommentar an YouTube übermittelt.');
      pending = undefined;
    } catch {
      status('Versandstatus unklar. Bitte auf YouTube prüfen. Kein automatischer Neuversand.');
    } finally {
      busy = false;
    }
  });
  return { request };
}
