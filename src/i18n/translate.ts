/**
 * Dictionary lookup + interpolation. Pure, dependency-free, testable.
 */

export type TranslationParams = Record<string, string | number>;

/** A recursive string dictionary (string leaves; arrays are opaque to `translate`). */
export interface TranslationTree {
  [key: string]: string | readonly string[] | TranslationTree;
}

function lookup(tree: TranslationTree, path: string): string | undefined {
  const parts = path.split(".");
  let node: string | readonly string[] | TranslationTree | undefined = tree;
  for (const part of parts) {
    if (node === undefined || typeof node === "string" || Array.isArray(node)) {
      return undefined;
    }
    node = (node as TranslationTree)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Resolve `path` or return `undefined` when the key is absent. */
export function translateOptional(
  tree: TranslationTree,
  path: string,
  params?: TranslationParams,
): string | undefined {
  const raw = lookup(tree, path);
  return raw === undefined ? undefined : interpolate(raw, params);
}

export function hasTranslation(tree: TranslationTree, path: string): boolean {
  return lookup(tree, path) !== undefined;
}

/**
 * Resolve `path` (dotted) against `tree`. Missing keys return the path itself
 * (and warn in development) so a gap is visible but never crashes a render.
 */
export function translate(
  tree: TranslationTree,
  path: string,
  params?: TranslationParams,
): string {
  const resolved = translateOptional(tree, path, params);
  if (resolved === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing translation: "${path}"`);
    }
    return path;
  }
  return resolved;
}

export type TranslateFn = (path: string, params?: TranslationParams) => string;
export type TranslateOptionalFn = (
  path: string,
  params?: TranslationParams,
) => string | undefined;

/** Bind a dictionary into a `t(path, params)` function. */
export function createTranslator(tree: TranslationTree): TranslateFn {
  return (path, params) => translate(tree, path, params);
}

export function createOptionalTranslator(
  tree: TranslationTree,
): TranslateOptionalFn {
  return (path, params) => translateOptional(tree, path, params);
}

/** Every dotted path to a string leaf in `tree` (for parity tests). */
export function collectLeafPaths(tree: TranslationTree, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      paths.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((_, i) => paths.push(`${path}.${i}`));
    } else if (value && typeof value === "object") {
      paths.push(...collectLeafPaths(value as TranslationTree, path));
    }
  }
  return paths.sort();
}
