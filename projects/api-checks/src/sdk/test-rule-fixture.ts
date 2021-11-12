import {
  factsToChangelog,
  OpenAPITraverser,
  OpenAPIV3,
  sourcemapReader,
} from "@useoptic/openapi-utilities";
import { ApiCheckDsl, ResultWithSourcemap } from "./types";
import { ApiCheckService, DslConstructorInput } from "./api-check-service";
import { JsonSchemaSourcemap } from "@useoptic/openapi-utilities/build/parser/openapi-sourcemap-parser";
import stringify from "json-stable-stringify";

type OpenApiInput =
  | OpenAPIV3.Document
  | ((old: OpenAPIV3.Document) => OpenAPIV3.Document);

export function createTestDslFixture<DSL extends ApiCheckDsl, Context>(
  dslConstructor: (input: DslConstructorInput<Context>) => DSL
) {
  function compare(input: OpenApiInput) {
    const base = openApiInputToDocument(
      input,
      JSON.parse(JSON.stringify(emptyOpenApi))
    );
    return {
      to: (input: OpenApiInput) => {
        const next = openApiInputToDocument(
          input,
          JSON.parse(JSON.stringify(base))
        );

        return {
          withRule: async (rule: (dsl: DSL) => void, context: Context) => {
            const checker = new ApiCheckService<Context>();
            checker.useDsl<DSL>((input) => dslConstructor(input), rule);
            const results = await checker.runRules(base, next, context);

            // const createMock = async (json: any) => {
            //   const mock = new JsonSchemaSourcemap();
            //   await mock.addFileIfMissingFromContents(
            //     "openapi.json",
            //     stringify(json),
            //     0
            //   );
            //   return {
            //     flattened: json,
            //     sourcemap: mock,
            //   };
            // };

            // const nextSourcemap = await createMock(next);

            const currentTraverser = new OpenAPITraverser();
            const nextTraverser = new OpenAPITraverser();

            await currentTraverser.traverse(base);
            const currentFacts = currentTraverser.accumulator.allFacts();
            await nextTraverser.traverse(next);
            const nextFacts = nextTraverser.accumulator.allFacts();

            // const { findFileAndLines } = sourcemapReader(
            //   nextSourcemap.sourcemap
            // );
            //
            // const resultWithSourcemap: ResultWithSourcemap[] =
            //   await Promise.all(
            //     results.map(async (checkResult) => {
            //       const sourcemap = await findFileAndLines(
            //         checkResult.change.location.jsonPath
            //       );
            //
            //       const splitFilePath = (sourcemap?.filePath || "").split("/");
            //       return {
            //         ...checkResult,
            //         sourcemap: {
            //           ...sourcemap,
            //           preview: "",
            //           filePath: splitFilePath.shift(),
            //         },
            //       } as ResultWithSourcemap;
            //     })
            //   );

            return {
              results,
              base: base,
              next: next,
              changelog: factsToChangelog(currentFacts, nextFacts),
            };
          },
        };
      },
    };
  }

  return { compare };
}

function openApiInputToDocument(
  input: OpenApiInput,
  baseOpenApi: OpenAPIV3.Document
): OpenAPIV3.Document {
  if (typeof input === "function") {
    return input(baseOpenApi);
  } else {
    return input;
  }
}

const emptyOpenApi: OpenAPIV3.Document = {
  openapi: "3.0.1",
  paths: {},
  info: { version: "0.0.0", title: "Empty" },
};
