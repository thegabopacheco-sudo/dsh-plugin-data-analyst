// Test end-to-end de data-analyst con CSV real y Python bundled.
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'data-analyst'), { recursive: true });
const csvPath = path.join(tmpDir, 'ventas.csv');
writeFileSync(csvPath, [
  'id,region,producto,monto,fecha',
  '1,MX,bot,120,2026-11-01',
  '2,MX,web,80,2026-11-02',
  '3,AR,bot,200,2026-11-03',
  '4,AR,web,60,2026-11-04',
  '5,MX,bot,150,2026-11-05',
  '6,CL,bot,90,2026-11-06',
].join('\n') + '\n', 'utf8');
const bundledPython = 'C:\\Users\\desco\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
writeFileSync(path.join(tmpDir, 'dsh-home', 'data-analyst', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir], pythonPath: bundledPython }, null, 2), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.DATA_SERVER ? path.resolve(process.env.DATA_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), DSH_PYTHON: bundledPython, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'data-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })).slice(0, 400));
const profile = await client.callTool({ name: 'profile', arguments: { path: csvPath } });
console.log('--- profile ---'); console.log(textOf(profile).slice(0, 700));
console.log('filas 6:', textOf(profile).includes('Filas: 6'));
const query = await client.callTool({ name: 'query', arguments: { path: csvPath, expression: 'monto > 100', columns: ['region', 'monto'], limit: 10 } });
console.log('--- query ---'); console.log(textOf(query));
const group = await client.callTool({ name: 'groupby', arguments: { path: csvPath, by: 'region', metric: 'monto', agg: 'sum' } });
console.log('--- groupby ---'); console.log(textOf(group));
const outCsv = path.join(tmpDir, 'export.csv');
const noConfirm = await client.callTool({ name: 'export', arguments: { path: csvPath, output: outCsv } });
console.log('export sin confirm isError:', noConfirm.isError === true);
const exported = await client.callTool({ name: 'export', arguments: { path: csvPath, output: outCsv, expression: 'monto > 100', confirm: true } });
console.log('--- export ---'); console.log(textOf(exported));
console.log('csv exportado existe:', existsSync(outCsv), '| filas:', existsSync(outCsv) ? readFileSync(outCsv, 'utf8').trim().split(/\r?\n/).length - 1 : 0);
const outside = await client.callTool({ name: 'profile', arguments: { path: path.join(tmpDir, '..', 'otro.csv') } });
console.log('fuera de allowedPaths isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_DATA_MODE: 'read-only' });
const roExport = await roClient.callTool({ name: 'export', arguments: { path: csvPath, output: outCsv, confirm: true } });
console.log('read-only export isError:', roExport.isError === true);
const roProfile = await roClient.callTool({ name: 'profile', arguments: { path: csvPath } });
console.log('read-only profile permitido:', roProfile.isError !== true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
