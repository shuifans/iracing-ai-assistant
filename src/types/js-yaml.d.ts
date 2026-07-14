declare module 'js-yaml' {
  export interface LoadOptions {
    schema?: unknown;
  }

  export const JSON_SCHEMA: unknown;
  export function load(input: string, options?: LoadOptions): unknown;
}
