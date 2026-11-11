#!/usr/bin/env node
// dsh-plugin-data-analyst — análisis de datos con pandas (Python bundled de DSH).
// Tools: status, profile, query, groupby, export.

import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CONFIG_FILE = path.join(DSH_HOME, 'data-analyst', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'data-analyst');
const AUDIT_FILE = path.join(CACHE_DIR, 'audit.jsonl');
const HELPER = path.join(HERE, 'scripts', 'data_helper.py');
const READ_ONLY = String(process.env.DSH_DATA_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[data] ${m}\n`);

function loadConfig() {
  const defaults = { allowedPaths: [process.env.USERPROFILE || os.homedir()], pythonPath: '' };
  try { if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch (e) { log(`config: ${e.message}`); }
  return defaults;
}
function audit(entry) { try { mkdirSync(CACHE_DIR, { recursive: true }); appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* best effort */ } }
function findPython(config) {
  const candidates = [];
  if (process.env.DSH_PYTHON) candidates.push(process.env.DSH_PYTHON);
  if (config.pythonPath) candidates.push(config.pythonPath);
  try {
    for (const entry of readdirSync(path.join(DSH_HOME, 'dsh-runtimes'), { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(DSH_HOME, 'dsh-runtimes', entry.name, 'dependencies', 'python', 'python.exe'));
    }
  } catch { /* sin runtimes */ }
  candidates.push('python');
  return candidates.find((candidate) => candidate === 'python' || existsSync(candidate)) || 'python';
}
function ensureAllowed(config, abs) {
  const lower = path.resolve(abs).toLowerCase();
  const ok = (config.allowedPaths || []).some((root) => {
    const r = path.resolve(root).toLowerCase();
    return lower === r || lower.startsWith(r + path.sep);
  });
  if (!ok) throw new Error(`ruta no permitida: ${abs}. allowedPaths: ${(config.allowedPaths || []).join(', ')}`);
  return path.resolve(abs);
}
function runHelper(config, payload) {
  return new Promise((resolve, reject) => {
    const python = findPython(config);
    let stdout = ''; let stderr = ''; let settled = false;
    const child = spawn(python, [HELPER], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { if (!settled) { settled = true; try { child.kill(); } catch { /* ignora */ } reject(new Error('el análisis agotó el tiempo (120 s)')); } }, 120_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`no se pudo ejecutar python (${python}): ${error.message}`)); } });
    child.on('close', () => {
      if (settled) return; settled = true; clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(stdout.trim()); } catch { reject(new Error(`respuesta inválida del helper: ${stdout.slice(0, 300)} ${stderr.slice(0, 300)}`)); return; }
      if (!parsed.ok) reject(new Error(parsed.error || 'el análisis falló'));
      else resolve(parsed);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
function textResult(t) { return { content: [{ type: 'text', text: t }] }; }
function humanTable(rows) {
  if (!rows.length) return '(sin filas)';
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(' | '), columns.map(() => '---').join(' | ')];
  for (const row of rows.slice(0, 40)) lines.push(columns.map((column) => row[column] === null ? '' : String(row[column])).join(' | '));
  if (rows.length > 40) lines.push(`... ${rows.length - 40} filas más`);
  return lines.join('\n');
}
async function pythonVersion(config) {
  return new Promise((resolve) => {
    const python = findPython(config);
    let out = '';
    const child = spawn(python, ['-c', 'import pandas,sys;print(sys.version.split()[0]+" pandas "+pandas.__version__)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolve('no disponible'));
    child.on('close', () => resolve(out.trim() || 'no disponible'));
  });
}

function buildInstructions() {
  return [
    'Data Analyst: analiza CSV/XLSX/JSON con pandas (Python bundled de DSH).',
    '',
    `Config: ${CONFIG_FILE}`,
    '',
    'Herramientas: status, profile, query, groupby, export.',
    '',
    'Reglas:',
    '- Solo lee dentro de allowedPaths.',
    '- export escribe archivos: requiere confirm:true y pedido explícito.',
    '- query usa expresiones de pandas (ej. "amount > 100 and region == \'MX\'").',
    '- Reporta filas/columnas/valores reales; no inventes estadísticas.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-data-analyst', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Python/pandas detectados, rutas permitidas y modo.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      return textResult([`Modo: ${READ_ONLY ? 'read-only' : 'normal'}`, `Python: ${findPython(config)}`, `Versión: ${await pythonVersion(config)}`, `Config: ${CONFIG_FILE}`, `Rutas permitidas: ${(config.allowedPaths || []).join(', ')}`, `Helper: ${HELPER} (${existsSync(HELPER) ? 'presente' : 'FALTA'})`].join('\n'));
    },
  );

  server.registerTool(
    'profile',
    { title: 'Perfil del dataset', description: 'Filas, columnas, tipos, nulos, estadísticas y top valores.', inputSchema: z.object({ path: z.string().min(3), head: z.number().int().min(1).max(20).optional() }) },
    async (args) => {
      const config = loadConfig();
      const absolute = ensureAllowed(config, args.path);
      if (!existsSync(absolute)) throw new Error(`archivo no encontrado: ${absolute}`);
      const result = await runHelper(config, { cmd: 'profile', path: absolute, head: args.head ?? 5 });
      const lines = [`${absolute}`, `Filas: ${result.rows} · columnas: ${result.columns}`, '', 'Tipos:', ...Object.entries(result.dtypes).map(([column, dtype]) => `  ${column}: ${dtype}`), '', 'Nulos:', ...(Object.keys(result.nulls).length ? Object.entries(result.nulls).map(([column, count]) => `  ${column}: ${count}`) : ['  ninguno'])];
      for (const [column, stats] of Object.entries(result.describe || {})) lines.push('', `${column}: min ${stats.min} · max ${stats.max} · mean ${Number(stats.mean).toFixed(2)}`);
      lines.push('', 'Primeras filas:', humanTable(result.head));
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'query',
    {
      title: 'Consultar filas',
      description: 'Filtra con una expresión pandas y devuelve filas (máx 50).',
      inputSchema: z.object({
        path: z.string().min(3),
        expression: z.string().max(500).optional().describe('Expresión pandas, ej. "amount > 100"'),
        columns: z.array(z.string()).max(30).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (args) => {
      const config = loadConfig();
      const absolute = ensureAllowed(config, args.path);
      const result = await runHelper(config, { cmd: 'query', path: absolute, expression: args.expression, columns: args.columns, limit: args.limit ?? 50 });
      return textResult(`Coincidencias: ${result.matched} · devueltas: ${result.returned}\n\n${humanTable(result.rows)}`);
    },
  );

  server.registerTool(
    'groupby',
    {
      title: 'Agrupar',
      description: 'Agrupa por una columna y suma/promedia/cuenta otra.',
      inputSchema: z.object({
        path: z.string().min(3),
        by: z.string().min(1),
        metric: z.string().min(1).optional(),
        agg: z.enum(['count', 'sum', 'mean', 'min', 'max']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => {
      const config = loadConfig();
      const absolute = ensureAllowed(config, args.path);
      const result = await runHelper(config, { cmd: 'groupby', path: absolute, by: args.by, metric: args.metric, agg: args.agg ?? 'count', limit: args.limit ?? 30 });
      return textResult(`Grupos: ${result.groups} · mostrando: ${result.rows.length}\n\n${humanTable(result.rows)}`);
    },
  );

  server.registerTool(
    'export',
    {
      title: 'Exportar subconjunto',
      description: 'Filtra y escribe CSV/XLSX. Requiere confirm:true.',
      inputSchema: z.object({
        path: z.string().min(3),
        output: z.string().min(3),
        expression: z.string().max(500).optional(),
        columns: z.array(z.string()).max(30).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: export deshabilitado');
      if (args.confirm !== true) throw new Error('export requiere confirm:true y confirmación explícita');
      const config = loadConfig();
      const input = ensureAllowed(config, args.path);
      const output = ensureAllowed(config, args.output);
      if (input.toLowerCase() === output.toLowerCase()) throw new Error('la salida no puede sobrescribir la entrada');
      const result = await runHelper(config, { cmd: 'write', path: input, output, expression: args.expression, columns: args.columns });
      audit({ tool: 'export', input: path.basename(input), output: path.basename(output), rows: result.rows, ok: true });
      return textResult(`Exportado: ${result.written} (${result.rows} filas × ${result.columns} columnas).`);
    },
  );

  return server;
}

try {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ allowedPaths: [process.env.USERPROFILE || ''], pythonPath: '' }, null, 2) + '\n', 'utf8');
  }
} catch (e) { log(`init: ${e.message}`); }
log(`modo ${READ_ONLY ? 'read-only' : 'normal'} · config: ${CONFIG_FILE} · python: ${findPython(loadConfig())}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
