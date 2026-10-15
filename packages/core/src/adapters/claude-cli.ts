import { realpathSync } from 'node:fs';
import { assertImagePath, assertSafeArg, buildEnv, CLAUDE_API_KEY_ENV_VARS, probeVersion } from '../process.js';
import type { CliAdapterOptions, ProviderAdapter, RunRequest } from '../types.js';
import { ClaudeStreamParser } from './claude-stream.js';
import { runCli } from './run-cli.js';

export interface ClaudeCliOptions extends CliAdapterOptions {
  /**
   * Run the CLI isolated from the user's global setup (default: true): no user/project settings, no MCP
   * servers except `mcpConfigPath`, no skills/slash commands. Measured on a real "say ok" run:
   * ~540,000 cached input tokens without isolation vs ~3,000 with it.
   */
  isolate?: boolean;
}

const SAFE_ID = /^[\w.:/[\]@-]+$/;
const SAFE_TOOL = /^[^\s\0-][^\n\r\0]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * `--allowedTools Edit` (or `Write`) lets the model write ANYWHERE the user can, not only in the working folder (verified
 * with the real CLI: a bare `Write` created a file outside the cwd). Only a path rule confines it, and the CLI says that
 * only `Edit(<path>)` rules count (they cover Write and MultiEdit too). So every file-writing tool becomes
 * `Edit(//<cwd>/**)`: absolute path from the root, for the folder as given and for its real path (symlinks such as
 * /home -> /var/home are resolved by the CLI). A rule the agent already scoped keeps its own path.
 */
export function scopeWriteTools(tools: readonly string[], cwd: string): string[] {
  const roots = new Set([cwd]);
  try {
    roots.add(realpathSync(cwd));
  } catch {
    // a folder that does not exist yet: the CLI will fail on it by itself
  }
  const out: string[] = [];
  for (const tool of tools) {
    const m = tool.trim().match(/^([A-Za-z]+)(?:\((.*)\))?$/);
    if (!m?.[1] || !WRITE_TOOLS.has(m[1])) out.push(tool);
    else if (m[2] !== undefined) out.push(`Edit(${m[2]})`);
    else for (const root of roots) out.push(`Edit(/${root.replace(/\/+$/, '')}/**)`);
  }
  return [...new Set(out)];
}

/**
 * Builds the argument vector for `claude`. The prompt is NOT part of it (it goes through stdin), so user
 * text can never be interpreted as a flag. Flags verified against `claude --help` (v2.1.x).
 */
export function buildClaudeArgs(req: RunRequest, opts: Pick<ClaudeCliOptions, 'isolate'> = {}): string[] {
  const args = ['-p', '--output-format=stream-json', '--verbose', '--include-partial-messages'];
  if (opts.isolate ?? true) args.push('--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '');
  if (req.model) args.push(`--model=${assertSafeArg('model', req.model, SAFE_ID)}`);
  if (req.resumeSessionId) {
    if (!UUID.test(req.resumeSessionId)) throw new Error(`Invalid resumeSessionId: ${JSON.stringify(req.resumeSessionId)}`);
    args.push(`--resume=${req.resumeSessionId}`);
  }
  if (req.systemAppend) {
    // A NUL byte cannot be part of an argv entry: spawn() would throw instead of the run reporting an error.
    if (req.systemAppend.includes('\0')) throw new Error('Invalid systemAppend: contains a NUL byte');
    args.push(`--append-system-prompt=${req.systemAppend}`);
  }
  if (req.mcpConfigPath) args.push(`--mcp-config=${assertSafeArg('mcpConfigPath', req.mcpConfigPath, /^[^\0]+$/)}`);
  const images = (req.images ?? []).map((p) => assertImagePath(p));
  if (req.noTools && images.length === 0) args.push('--tools', '');
  else {
    // Claude looks at an image by reading the file: allow the Read tool and the folders the images live in.
    const tools = scopeWriteTools([...new Set([...(req.allowedTools ?? []), ...(images.length ? ['Read'] : [])])], req.cwd);
    for (const t of tools) assertSafeArg('allowed tool', t, SAFE_TOOL);
    for (const dir of new Set(images.map((p) => p.slice(0, p.lastIndexOf('/')) || '/'))) args.push(`--add-dir=${dir}`);
    if (tools.length) args.push('--allowedTools', ...tools);
  }
  return args;
}

/** The text sent on stdin: for images, tells Claude which files to read before the user's prompt. */
export function buildClaudePrompt(req: RunRequest): string {
  if (!req.images?.length) return req.prompt;
  const list = req.images.map((p) => `- ${p}`).join('\n');
  return `[Imagens anexas. Use a ferramenta Read para ver cada arquivo:\n${list}]\n\n${req.prompt}`;
}

export function createClaudeCliAdapter(opts: ClaudeCliOptions = {}): ProviderAdapter {
  const bin = opts.bin ?? 'claude';
  const binArgs = opts.binArgs ?? [];
  const env = () => buildEnv(opts.env ?? process.env, opts.authMode ?? 'subscription', CLAUDE_API_KEY_ENV_VARS);
  return {
    id: 'claude-cli',
    isAvailable: () => probeVersion(bin, binArgs, env()),
    async *run(req, signal) {
      let args: string[];
      try {
        args = [...binArgs, ...buildClaudeArgs(req, opts)];
      } catch (e) {
        yield { type: 'start', runId: req.runId ?? 'invalid', provider: 'claude-cli' };
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
        return;
      }
      yield* runCli({
        provider: 'claude-cli',
        bin,
        args,
        stdin: buildClaudePrompt(req),
        req,
        env: env(),
        signal,
        killGraceMs: opts.killGraceMs,
        parser: new ClaudeStreamParser(),
      });
    },
  };
}
