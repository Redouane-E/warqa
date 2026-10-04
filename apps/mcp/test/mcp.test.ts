// Spawn the MCP server over stdio and exercise a few tools.
import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const server = fileURLToPath(new URL('../dist/server.js', import.meta.url));
let p: ChildProcess;
let buf = '';
let id = 0;
const pending = new Map<number, (m: { result?: any; error?: unknown }) => void>();
const call = (method: string, params: unknown) =>
  new Promise<{ result?: any; error?: unknown }>((ok) => {
    const n = ++id;
    pending.set(n, ok);
    p.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });

beforeAll(async () => {
  p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'] });
  p.stdout!.on('data', (d) => {
    buf += d;
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      i = buf.indexOf('\n');
    }
  });
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  p.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
});
afterAll(() => {
  p.kill();
});

describe('warqa MCP server', () => {
  it('lists the authoring tools', async () => {
    const r = await call('tools/list', {});
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['warqa_validate_lesson', 'warqa_render', 'warqa_component_catalog', 'warqa_save_lesson']));
  });

  it('returns actionable validation errors', async () => {
    const lesson = { id: 'x', title: 'T', lang: 'en', beats: [{ id: 'a', title: 'A', narration: 'Hello [[m]]world.', scene: { add: [{ id: 'eq', type: 'equation', steps: [['1', ' + ', '1']] }] }, cues: [{ at: 'nope', do: 'step', target: 'eq' }] }] };
    const r = await call('tools/call', { name: 'warqa_validate_lesson', arguments: { lesson } });
    const out = JSON.parse(r.result.content[0].text);
    expect(out.ok).toBe(false);
    expect(out.errors[0].message).toContain('unknown mark "nope"');
  });

  it('serves the component catalog', async () => {
    const r = await call('tools/call', { name: 'warqa_component_catalog', arguments: { types: ['numberline'] } });
    expect(r.result.content[0].text).toContain('### numberline');
  });
});
