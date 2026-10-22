// Schema variants. Each one changes one thing about what the model sees, starting from the schemas
// published in aussie-data-mcp 0.1.0 ("baseline"). The server behind every variant is identical:
// the same validation, the same normalising of values, the same data. Only the schema text, its
// shape, or the wording of error messages differs.
import { TOOLS, toolByName, type Param, type ToolSpec } from './tools.ts';

export const VARIANTS = {
  baseline: 'Schemas as published: full descriptions, enums, flat arguments, helpful errors',
  'terse-descriptions': 'One-line tool descriptions, no parameter descriptions',
  'no-enums': 'Enums removed from the schema (the server still only accepts the same values)',
  nested: 'Arguments grouped into select / period / options objects',
  'terse-errors': 'Error messages say only that the call failed, not why',
  'no-enums-terse-errors': 'Both at once: no enums to guide the first try, and errors that don\'t say what went wrong',
} as const;
export type Variant = keyof typeof VARIANTS;
export const VARIANT_NAMES = Object.keys(VARIANTS) as Variant[];

export const hidesEnums = (v: Variant) => v === 'no-enums' || v === 'no-enums-terse-errors';
export const terseErrors = (v: Variant) => v === 'terse-errors' || v === 'no-enums-terse-errors';

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

const GROUPS = ['select', 'period', 'options'] as const;

function paramSchema(p: Param, v: Variant): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const withEnum = p.enum && !hidesEnums(v);
  if (p.type === 'string[]') {
    s.type = 'array';
    s.items = withEnum ? { type: 'string', enum: [...p.enum!] } : { type: 'string' };
    if (Array.isArray(p.default)) s.minItems = 1;
  } else {
    s.type = p.type;
    if (withEnum) s.enum = [...p.enum!];
    if (p.pattern) s.pattern = p.pattern.source;
    if (p.type === 'string' && p.min != null) s.minLength = p.min;
    if (p.type === 'integer') {
      if (p.min != null) s.minimum = p.min;
      if (p.max != null) s.maximum = p.max;
    }
  }
  if (p.default !== undefined) s.default = p.default;
  if (p.description && v !== 'terse-descriptions') s.description = p.description;
  return s;
}

function objectSchema(params: Param[], v: Variant): Record<string, unknown> {
  const required = params.filter((p) => p.required).map((p) => p.name);
  return {
    type: 'object',
    properties: Object.fromEntries(params.map((p) => [p.name, paramSchema(p, v)])),
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

export function toolDefs(v: Variant): ToolDef[] {
  return TOOLS.map((t) => {
    let input_schema: Record<string, unknown>;
    if (v === 'nested') {
      const top = t.params.filter((p) => p.group === 'top');
      const s = objectSchema(top, v);
      const props = s.properties as Record<string, unknown>;
      for (const g of GROUPS) {
        const ps = t.params.filter((p) => p.group === g);
        if (ps.length) props[g] = objectSchema(ps, v);
      }
      input_schema = s;
    } else {
      input_schema = objectSchema(t.params, v);
    }
    return { name: t.name, description: v === 'terse-descriptions' ? t.short : t.description, input_schema };
  });
}

// ---------- server side: turn any variant's arguments into one canonical call ----------

export interface ArgProblem { path: string; problem: string; allowed?: readonly string[] }
export type Canonical = { ok: true; args: Record<string, unknown> } | { ok: false; problems: ArgProblem[] };

/** "New South Wales" -> "new_south_wales", "Sydney CBD" -> "sydney_cbd". Same in every variant. */
export const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

function checkValue(p: Param, raw: unknown, path: string, problems: ArgProblem[]): unknown {
  const bad = (problem: string) => { problems.push({ path, problem, allowed: p.enum }); return undefined; };
  const one = (x: unknown, at: string): unknown => {
    if (typeof x !== 'string') return bad(`${at} should be a string, got ${JSON.stringify(x)}`);
    if (p.enum) {
      const hit = p.enum.find((e) => norm(e) === norm(x));
      if (!hit) return bad(`"${x}" isn't a valid value`);
      return hit;
    }
    if (p.pattern && !p.pattern.test(x)) return bad(`"${x}" should be ${p.patternHint}`);
    if (p.min != null && x.trim().length < p.min) return bad(`should be at least ${p.min} characters`);
    return x;
  };
  switch (p.type) {
    case 'string':
      return one(raw, 'value');
    case 'string[]': {
      if (!Array.isArray(raw)) return bad(`should be a list of strings, got ${JSON.stringify(raw)}`);
      if (!raw.length && Array.isArray(p.default)) return bad('should have at least one value');
      const out = raw.map((x) => one(x, 'each value'));
      return out.some((x) => x === undefined) ? undefined : out;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : bad(`should be true or false, got ${JSON.stringify(raw)}`);
    case 'integer':
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return bad(`should be a whole number, got ${JSON.stringify(raw)}`);
      if ((p.min != null && raw < p.min) || (p.max != null && raw > p.max)) return bad(`should be between ${p.min} and ${p.max}`);
      return raw;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function canonicalize(tool: ToolSpec, v: Variant, input: unknown): Canonical {
  const problems: ArgProblem[] = [];
  const args: Record<string, unknown> = {};
  if (!isObject(input)) return { ok: false, problems: [{ path: '(arguments)', problem: 'should be an object' }] };

  // Find where each parameter's raw value lives for this variant
  const located = new Map<Param, { raw: unknown; path: string }>();
  if (v === 'nested') {
    const top = new Set(tool.params.filter((p) => p.group === 'top').map((p) => p.name));
    const groups = new Set(tool.params.filter((p) => p.group !== 'top').map((p) => p.group));
    for (const k of Object.keys(input)) if (!top.has(k) && !groups.has(k as never)) problems.push({ path: k, problem: 'unknown argument' });
    for (const g of groups) {
      const obj = input[g];
      if (obj === undefined) continue;
      if (!isObject(obj)) { problems.push({ path: g, problem: 'should be an object' }); continue; }
      const names = new Set(tool.params.filter((p) => p.group === g).map((p) => p.name));
      for (const k of Object.keys(obj)) if (!names.has(k)) problems.push({ path: `${g}.${k}`, problem: 'unknown argument' });
    }
    for (const p of tool.params) {
      const raw = p.group === 'top' ? input[p.name] : (isObject(input[p.group]) ? (input[p.group] as Record<string, unknown>)[p.name] : undefined);
      located.set(p, { raw, path: p.group === 'top' ? p.name : `${p.group}.${p.name}` });
    }
  } else {
    const names = new Set(tool.params.map((p) => p.name));
    for (const k of Object.keys(input)) if (!names.has(k)) problems.push({ path: k, problem: 'unknown argument' });
    for (const p of tool.params) located.set(p, { raw: input[p.name], path: p.name });
  }

  for (const [p, { raw, path }] of located) {
    if (raw === undefined || raw === null) {
      if (p.required) problems.push({ path, problem: 'is required' });
      else if (p.default !== undefined) args[p.name] = p.default;
      continue;
    }
    const val = checkValue(p, raw, path, problems);
    if (val !== undefined) args[p.name] = val;
  }
  return problems.length ? { ok: false, problems } : { ok: true, args };
}

export function validationError(tool: ToolSpec, v: Variant, problems: ArgProblem[]): string {
  if (terseErrors(v)) return 'Error: invalid arguments.';
  const lines = problems.map((x) => `- ${x.path}: ${x.problem}${x.allowed ? `. Use one of: ${x.allowed.join(', ')}` : ''}`);
  return `Error: invalid arguments for ${tool.name}:\n${lines.join('\n')}`;
}

export function runtimeError(v: Variant, message: string): string {
  return terseErrors(v) ? 'Error: request failed.' : `Error: ${message}`;
}

export function specFor(name: string): ToolSpec | undefined {
  return toolByName.get(name);
}
