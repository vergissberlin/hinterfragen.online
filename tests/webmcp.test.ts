import { describe, it, expect, vi } from 'vitest';
import { createTools } from '../src/lib/webmcp.ts';
import { commentBody } from '../src/lib/youtube-publish.ts';
import { demoCatalog } from '../src/lib/demo.ts';
describe('WebMCP und YouTube', () => {
  it('stellt strukturierte Daten bereit, validiert Eingaben und veröffentlicht nie selbst', () => {
    const request = vi.fn(() => ({ status: 'awaiting_user_approval' })),
      edit = vi.fn(),
      prepare = vi.fn(() => ({ question: 'Welche Belege gibt es?', originalUrl: null }));
    const tools = createTools({
      current: () => demoCatalog.posts[0],
      next: () => demoCatalog.posts[1],
      prepare,
      edit,
      requestPublish: request,
    });
    expect(tools).toHaveLength(4);
    expect(tools[0].annotations.readOnlyHint).toBe(true);
    expect(tools[0].execute({})).toMatchObject({ contentIsUntrusted: true });
    expect(tools[2].execute({ questionIndex: 9 })).toHaveProperty('error');
    expect(prepare).not.toHaveBeenCalled();
    expect(tools[2].execute({ text: 'Eigene Frage?' })).toMatchObject({
      status: 'draft',
      publicationRequiresUserApproval: true,
    });
    expect(edit).toHaveBeenCalledWith('Eigene Frage?');
    expect(tools[3].execute({})).toEqual({ status: 'awaiting_user_approval' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('verbietet Demo-Ziele und erzeugt ausschließlich einen expliziten Einzelkommentar', () => {
    expect(() => commentBody(demoCatalog.posts[0], 'Test?')).toThrow();
    const post = {
      ...demoCatalog.posts[0],
      demo: false,
      videoId: 'abcdefghijk',
      channelId: 'UC' + 'x'.repeat(22),
    };
    expect(commentBody(post, ' Eigene Frage? ')).toEqual({
      snippet: {
        channelId: post.channelId,
        videoId: post.videoId,
        topLevelComment: { snippet: { textOriginal: 'Eigene Frage?' } },
      },
    });
    expect(() => commentBody(post, '')).toThrow();
  });
});
