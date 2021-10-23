import $RefParser from "@apidevtools/json-schema-ref-parser";
// @ts-ignore
import * as $RefParserOptions from "@apidevtools/json-schema-ref-parser/lib/options";
import * as YAML from "yaml-ast-parser";
import * as fs from "fs-extra";
import { YAMLMapping, YAMLNode, YAMLSequence } from "yaml-ast-parser";
// @ts-ignore
import { dereference } from "./insourced-dereference";
import * as pointer from "json-ptr";

export async function parseOpenAPIWithSourcemap(path: string) {
  const resolver = new $RefParser();

  const sourcemap = new JsonSchemaSourcemap();
  const resolverResults: $RefParser.$Refs = await resolver.resolve(path);

  // parse all asts
  await Promise.all(
    resolverResults
      .paths()
      .map((filePath) => sourcemap.addFileIfMissing(filePath))
  );

  dereference(
    resolver,
    { ...$RefParserOptions.defaults, path: path },
    sourcemap
  );

  return { jsonLike: resolver.schema, sourcemap: sourcemap.serialize() };
}

type JsonPath = string;
type FileReference = number;

type DerefToSource = [JsonPath, LocationRecord];

interface JsonSchemaSourcemapOutput {
  files: Array<{
    path: string;
    index: number;
  }>;
  map: DerefToSource[];
}

export class JsonSchemaSourcemap {
  private _files: Array<{
    path: string;
    index: number;
    ast: YAMLNode;
  }> = [];

  private _mappings: Array<DerefToSource> = [];

  async addFileIfMissing(filePath: string) {
    if (!this._files.find((i) => i.path === filePath)) {
      // add the ast to the cache
      const yamlAst: YAMLNode = YAML.safeLoad(
        (await fs.readFile(filePath)).toString()
      );

      this._files.push({
        path: filePath,
        index: this._files.length,
        ast: yamlAst,
      });
    }
  }

  log(path: string, pathFromRoot: string) {
    const thisFile = this._files.find((i) => path.startsWith(i.path));
    if (thisFile) {
      const jsonPointer = path.split(thisFile.path)[1].substring(1) || "/";
      const sourceMapping = resolveJsonPointerInYamlAst(
        thisFile.ast,
        jsonPointer,
        thisFile.index
      );
      if (sourceMapping) {
        this._mappings.push([pathFromRoot, sourceMapping]);
      }
    }
  }

  public serialize(): JsonSchemaSourcemapOutput {
    return {
      files: this._files.map((i) => ({ path: i.path, index: i.index })),
      map: this._mappings,
    };
  }
}

export function resolveJsonPointerInYamlAst(
  node: YAMLNode,
  jsonPointer: string,
  file: number
): LocationRecord | undefined {
  const decoded = pointer.decodePointer(jsonPointer);

  const isEmpty =
    decoded.length === 0 || (decoded.length === 1 && decoded[0] === "");

  if (isEmpty) return { n: [node.startPosition, node.endPosition], f: file };

  const found: YAMLNode | undefined = decoded.reduce((current, path) => {
    const isFieldKey = isNaN(Number(path));
    if (!current) return undefined;

    const node: YAMLNode = current.key ? current.value : current;

    if (isFieldKey) {
      const field = node.mappings.find(
        (i: YAMLMapping) => i.key.value === path
      );
      return field;
    } else {
      // is number
      return (node as YAMLSequence).items[Number(path)];
    }
  }, node as YAMLNode | undefined);

  if (found) {
    if (found.key) {
      // is a field
      return {
        k: [found.key.startPosition, found.key.endPosition],
        v: [found.value.startPosition, found.value.endPosition],
        n: [found.startPosition, found.endPosition],
        f: file,
      };
    } else {
      return { n: [found.startPosition, found.endPosition], f: file };
    }
  }
}

type AstLocation = [number, number];
interface LocationRecord {
  k?: AstLocation;
  v?: AstLocation;
  n: AstLocation;
  f: number;
}
