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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `body` as JSON. A body whose `instance_schema` carries XMD written as JSON (`{ yml: { value: RawJson } }`) is
 * written with that schema's own text at `instance_schema`'s place, after the body's other fields; every other body
 * is `JSON.stringify`'s, each of its fields read once, as it always was.
 */
export function serializeBody(body: unknown): string {
  const schema = isRecord(body) && Object.hasOwn(body, "instance_schema") ? body["instance_schema"] : undefined;
  const yml = isRecord(schema) && Object.hasOwn(schema, "yml") ? schema["yml"] : undefined;
  const value = isRecord(yml) && Object.hasOwn(yml, "value") ? yml["value"] : undefined;
  if (!isRecord(body) || !(value instanceof RawJson)) {
    return JSON.stringify(body);
  }
  const rest: Record<string, unknown> = { ...body };
  delete rest["instance_schema"];
  const written = `{"yml":{"value":${value.text.trim()}}}`;
  const head = JSON.stringify(rest);
  return head === "{}" ? `{"instance_schema":${written}}` : `${head.slice(0, -1)},"instance_schema":${written}}`;
}
