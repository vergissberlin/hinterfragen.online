import {
  originalUrl as sourceUrl,
  sourceKey,
  catalogSchema,
  selectPost,
  topics,
  type Catalog,
  type PublicPost,
} from './contracts.ts';
import { demoCatalog } from './demo.ts';
import { registerWebMcp } from './webmcp.ts';
import { setupYoutubePublishing } from './youtube-publish.ts';
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const show = (id: string, visible: boolean) => {
  element(id).hidden = !visible;
};
const set = (id: string, value: string) => {
  element(id).textContent = value;
};
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing must still work. */
  }
};
let catalog: Catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  demo: false,
  posts: [],
};
let current: PublicPost | undefined;
let seen: string[] = [];
let count = Number(read('hf:count', 0)) || 0;
const savedTopics = read<unknown>('hf:topics', Object.keys(topics));
let selected: string[] = Array.isArray(savedTopics)
  ? savedTopics.filter((t) => typeof t === 'string' && Object.hasOwn(topics, t))
  : Object.keys(topics);
const pendingEvents = new Set<string>();
set('local-count', String(count));
function feedback(message: string) {
  set('feedback', message);
}
function record(type: 'original_open' | 'question_copy') {
  count++;
  write('hf:count', count);
  set('local-count', String(count));
  if (!current || current.demo) return;
  const key = `${current.id}:${type}`;
  if (pendingEvents.has(key)) return;
  pendingEvents.add(key);
  // Best effort, no retries, cookies or persistent visitor identifier.
  void fetch('/api/events', {
    method: 'POST',
    credentials: 'omit',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: current.id, type }),
  }).catch(() => {});
}
function activePost() {
  if (current && Date.parse(current.expiresAt) <= Date.now()) {
    next();
    return undefined;
  }
  return current;
}
function next() {
  current = selectPost(catalog.posts, selected, seen);
  show('question-panel', false);
  feedback('');
  element('beitrag').setAttribute('aria-busy', 'false');
  show('post-content', Boolean(current));
  show('empty-state', !current);
  if (!current) {
    set(
      'empty-message',
      'Gerade ist kein geprüfter Beitrag zu deinen Themen verfügbar. Versuch es später oder wähle weitere Themen.',
    );
    return;
  }
  seen = [...seen.slice(-99), current.id];
  set('post-topic', topics[current.topic]);
  set(
    'post-source',
    current.demo ? 'BEISPIEL · KEIN REALER BEITRAG' : `YouTube · ${current.channel}`,
  );
  const isReply = current.target?.type === 'comment';
  set('post-title-link', isReply ? 'Kommentar zu: ' + current.title : current.title);
  set('post-author-label', isReply ? 'Kommentar von' : 'Beitrag von');
  const authorName = current.author?.name ?? current.channel;
  set('post-author-name', authorName);
  const authorLink = element<HTMLAnchorElement>('post-author-name');
  if (current.author?.profileUrl?.startsWith('https://www.youtube.com/channel/'))
    authorLink.href = current.author.profileUrl;
  else authorLink.removeAttribute('href');
  const avatar = element<HTMLImageElement>('post-author-avatar');
  avatar.src = current.author?.avatarUrl ?? '/avatars/placeholder.svg';
  avatar.alt = 'Profilbild von ' + authorName;
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = '/avatars/placeholder.svg';
  };
  set(
    'post-original',
    isReply ? 'Original-Kommentar auf YouTube ansehen ↗' : 'Originalbeitrag auf YouTube ansehen ↗',
  );
  const originalUrl = current.demo ? undefined : sourceUrl(current);
  for (const id of ['post-title-link', 'post-original']) {
    const link = element<HTMLAnchorElement>(id);
    if (originalUrl) link.href = originalUrl;
    else link.removeAttribute('href');
  }
  show('post-original', !current.demo);
  show('post-demo-source', Boolean(current.demo));
  set('post-summary', current.summary);
  set('post-quote', current.evidence.quote);
  const seconds = current.evidence.startSeconds;
  set(
    'post-timestamp',
    isReply
      ? current.demo
        ? 'Erfundener Kommentar'
        : 'Kommentar auf YouTube'
      : `${current.demo ? 'Fiktive Aussage' : 'Aussage im Video'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  );
  set('post-context', current.evidence.context);
  set(
    'post-check',
    current.demo
      ? 'Dieses Beispiel dient nur der Vorschau.'
      : `Verfügbarkeit und Kommentare zuletzt geprüft: ${new Date(current.checkedAt).toLocaleString('de-DE')}. KI-Analyse mit dokumentiertem Kontext; keine Garantie für Fehlerfreiheit.`,
  );
  (element('beitrag').querySelector('details') as HTMLDetailsElement).open = false;
}
function chooseQuestion(index: number, scroll = false) {
  const post = activePost();
  if (!post) return undefined;
  show('question-panel', true);
  element('question-options').replaceChildren(
    ...post.questions.map((question, i) => {
      const button = document.createElement('button');
      button.className = 'question-option';
      button.textContent = question;
      button.setAttribute('aria-pressed', String(i === index));
      button.addEventListener('click', () => chooseQuestion(i));
      return button;
    }),
  );
  element<HTMLTextAreaElement>('question-editor').value =
    post.questions[index] ?? post.questions[0];
  const link = element<HTMLAnchorElement>('original-link');
  show('youtube-publish', Boolean(import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID) && !post.demo);
  show('original-link', !post.demo);
  show('demo-question-note', Boolean(post.demo));
  if (!post.demo) link.href = sourceUrl(post);
  else link.removeAttribute('href');
  if (scroll)
    element('question-panel').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  return {
    postId: post.id,
    videoId: post.videoId,
    question: element<HTMLTextAreaElement>('question-editor').value,
    originalUrl: post.demo ? null : link.href,
    targetKey: sourceKey(post),
    target: post.target ?? { type: 'video' },
    demo: post.demo,
  };
}
function editQuestion(text: string) {
  element<HTMLTextAreaElement>('question-editor').value = text;
  element('question-options')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', 'false'));
}
element('filter-toggle').addEventListener('click', () => {
  const open = element('filters').hidden !== false;
  show('filters', open);
  element('filter-toggle').setAttribute('aria-expanded', String(open));
});
document.querySelectorAll<HTMLInputElement>('#filters input').forEach((input) => {
  input.checked = selected.includes(input.value);
  input.addEventListener('change', () => {
    selected = Array.from(
      document.querySelectorAll<HTMLInputElement>('#filters input:checked'),
    ).map((i) => i.value);
    write('hf:topics', selected);
    seen = [];
    next();
  });
});
element('next-post').addEventListener('click', next);
element('ask-post').addEventListener('click', () => chooseQuestion(0, true));
element('beitrag').addEventListener('keydown', (event) => {
  if (event.target !== element('beitrag')) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    next();
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    chooseQuestion(0, true);
  }
});
let pointer: { x: number; y: number; id: number } | undefined;
element('beitrag').addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('button,a,summary,details')) return;
  pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
});
element('beitrag').addEventListener('pointerup', (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x,
    dy = event.clientY - pointer.y;
  pointer = undefined;
  if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (dx < 0) next();
  else chooseQuestion(0, true);
});
element('beitrag').addEventListener('pointercancel', () => {
  pointer = undefined;
});
element('copy-question').addEventListener('click', async () => {
  if (!activePost()) return;
  const text = element<HTMLTextAreaElement>('question-editor').value.trim();
  if (!text) {
    feedback('Formuliere zuerst deine Frage.');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    record('question_copy');
    feedback('Frage kopiert. Du entscheidest, ob du sie postest.');
  } catch {
    element<HTMLTextAreaElement>('question-editor').select();
    feedback('Kopieren ist hier gesperrt. Du kannst den markierten Text selbst kopieren.');
  }
});
for (const id of ['original-link', 'post-original', 'post-title-link'])
  element(id).addEventListener('click', (event) => {
    if (!activePost() || current?.demo) event.preventDefault();
    else record('original_open');
  });
async function load(preserve = false) {
  show('retry-catalog', false);
  try {
    if (document.body.dataset.demo === 'true') {
      catalog = demoCatalog;
      show('catalog-notice', true);
      set(
        'catalog-notice',
        'VORSCHAU · Alle Beispiele sind erfunden. Keine realen Accounts, kein Versand von Klickdaten.',
      );
    } else {
      const response = await fetch('/data/catalog.json', {
        credentials: 'omit',
        cache: 'no-cache',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('catalog');
      catalog = catalogSchema.parse(await response.json());
      // Live builds never accept demonstration data, even from a stale catalog.
      if (catalog.demo || catalog.posts.some((p) => p.demo)) throw new Error('demo_in_live');
    }
    if (preserve && current) {
      const fresh = catalog.posts.find(
        (p) => p.id === current!.id && Date.parse(p.expiresAt) > Date.now(),
      );
      if (
        fresh &&
        fresh.summary === current.summary &&
        JSON.stringify(fresh.evidence) === JSON.stringify(current.evidence) &&
        JSON.stringify(fresh.questions) === JSON.stringify(current.questions) &&
        sourceKey(fresh) === sourceKey(current) &&
        JSON.stringify(fresh.author) === JSON.stringify(current.author)
      ) {
        current = fresh;
        return;
      }
      next();
      feedback('Der Beitrag wurde aktualisiert oder ist nicht mehr verfügbar.');
    } else next();
  } catch {
    if (preserve) return;
    show('post-content', false);
    show('empty-state', true);
    show('retry-catalog', true);
    set(
      'empty-message',
      'Der Beitragskatalog ist gerade nicht erreichbar. Die Idee und Druckvorlagen bleiben verfügbar.',
    );
    element('beitrag').setAttribute('aria-busy', 'false');
  }
}
element('retry-catalog').addEventListener('click', () => void load());
void load();
if (document.body.dataset.demo !== 'true') setInterval(() => void load(true), 60000);
setInterval(() => {
  if (current && Date.parse(current.expiresAt) <= Date.now()) next();
}, 30000);
void fetch('/data/stats.json', { credentials: 'omit' })
  .then((r) => r.json())
  .then((s) => {
    if (Number.isSafeInteger(s.original_open) && s.original_open > 0) {
      set(
        'global-stats',
        `${s.original_open.toLocaleString('de-DE')} Originalaufrufe insgesamt · Klicks, keine nachgewiesenen Kommentare.`,
      );
      show('global-stats', true);
    }
  })
  .catch(() => {});
const publishing = setupYoutubePublishing({
  current: activePost,
  question: () => element<HTMLTextAreaElement>('question-editor').value.trim(),
  feedback,
});
void registerWebMcp({
  current: activePost,
  next: () => {
    next();
    return activePost();
  },
  prepare: (index) => chooseQuestion(index, false),
  edit: editQuestion,
  requestPublish: publishing.request,
});
