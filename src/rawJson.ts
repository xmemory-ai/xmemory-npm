/**
 * JSON text sent as it is inside a request body, so each of its numbers keeps the token the text gives it: `1.0`
 * stays a float and an integer past 2^53 stays exact, which a parsed value written out again would not keep.
 * `toJSON` gives the parsed value, for a serializer that does not know this class.
 */
export class RawJson {
  constructor(
    readonly text: string,
    readonly parsed: unknown,
  ) {}

  toJSON(): unknown {
    return this.parsed;
  }
}

/** `body` as JSON, each {@link RawJson} in it written as its own text. */
export function serializeBody(body: unknown): string {
  const texts: string[] = [];
  // A string no JSON text holds unescaped, written in each RawJson's place and then replaced by its text.
  const placeholder = (index: number) => `\u0000raw-json-${index}\u0000`;
  const serialized = JSON.stringify(body, function (this: Record<string, unknown>, key: string, value: unknown) {
    // `this[key]` is the value before its `toJSON` ran, so a RawJson is seen here and not its parsed value.
    const original = this[key];
    if (original instanceof RawJson) {
      texts.push(original.text.trim());
      return placeholder(texts.length - 1);
    }
    return value;
  });
  return texts.reduce((written, text, index) => written.replace(JSON.stringify(placeholder(index)), () => text), serialized);
}
