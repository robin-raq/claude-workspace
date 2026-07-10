import { styleText } from 'node:util';

type StyleFormat = Parameters<typeof styleText>[0];

/**
 * Color is disabled by --no-color or by the NO_COLOR convention (presence of
 * the variable, regardless of value). Role labels always remain in the text,
 * so color is never the only distinguishing signal.
 */
export function shouldUseColor(
  env: Record<string, string | undefined>,
  noColorFlag: boolean,
): boolean {
  if (noColorFlag) return false;
  if ('NO_COLOR' in env) return false;
  return true;
}

export type Colorize = (format: StyleFormat, text: string) => string;

export function makeColorizer(enabled: boolean): Colorize {
  if (!enabled) {
    return (_format, text) => text;
  }
  return (format, text) => styleText(format, text, { validateStream: false });
}
