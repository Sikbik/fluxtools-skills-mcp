import { describe, expect, it } from 'vitest';

import { callTool } from '../src/index.js';

describe('flux_resource_prune', () => {
  it('clears all resources', async () => {
    const r = await callTool('flux_resource_prune', { clearAll: true });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('clearAll');

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.action).toBe('clearAll');
  });
});
