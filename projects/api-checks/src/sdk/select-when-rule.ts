import {
  DocsLinkHelper,
  newDocsLinkHelper,
  Result,
  runCheck,
  ShouldOrMust,
} from "./types";
import { OpenAPIV3 } from "openapi-types";
import jsonpath from "jsonpath";
import { ConceptualLocation, IChange, OpenApiFact } from "@useoptic/openapi-utilities";
import equals from "fast-deep-equal";

export function createSelectJsonPathHelper(
  operations: {
    current: OpenAPIV3.OperationObject;
    next: OpenAPIV3.OperationObject;
    conceptualLocation: ConceptualLocation;
  }[],
  pushCheck: (...check: Promise<Result>[]) => void = () => {} // default empty for testing
): {
  selectJsonPath: (
    humanReadable: string,
    path: string
  ) => {
    when: <T>(
      qualifier: <T>(current: T[], next: T[]) => boolean
    ) => ShouldOrMust<
      (current: T[], next: T[], docsHelper: DocsLinkHelper) => void
    >;
  };
} {
  function selectJsonPath(
    humanReadable: string,
    path: string
  ): {
    when: <T>(
      qualifier: <T>(current: T[], next: T[]) => boolean
    ) => ShouldOrMust<
      (current: T[], next: T[], docsHelper: DocsLinkHelper) => void
    >;
  } {
    return {
      when: <T>(qualifier: <T>(current: T[], next: T[]) => boolean) => {
        type Re = ShouldOrMust<
          (current: T[], next: T[], docsHelper: DocsLinkHelper) => void
        >;

        const selectRuleHandler: (must: boolean) => Re["must"] = (
          must: boolean
        ) => {
          return (statement, handler) => {
            operations.forEach((operation) => {
              const currentResults = jsonpath.query(operation.current, path);
              const nextResults = jsonpath.query(operation.next, path);
              const shouldRun = qualifier(currentResults, nextResults);
              const fakeChange: IChange<OpenApiFact> = {
                added:
                  nextResults.length > 0 && currentResults.length === 0
                    ? nextResults
                    : undefined,
                changed: equals(currentResults, nextResults)
                  ? undefined
                  : {
                      before: currentResults,
                      after: nextResults,
                    },
                removed:
                  currentResults.length > 0 && nextResults.length === 0
                    ? { before: currentResults }
                    : undefined,
                location: {
                  conceptualLocation: operation.conceptualLocation,
                  conceptualPath: ["json-path", path],
                  jsonPath: "/",
                  kind: "custom-json-path",
                },
              };

              if (shouldRun) {
                const docsHelper = newDocsLinkHelper();
                pushCheck(
                  runCheck(
                    fakeChange,
                    docsHelper,
                    humanReadable,
                    statement,
                    must,
                    () => handler(currentResults, nextResults, docsHelper)
                  )
                );
              }
            });
          };
        };

        const rule: ShouldOrMust<
          (current: T[], next: T[], docsHelper: DocsLinkHelper) => void
        > = {
          must: selectRuleHandler(true),
          should: selectRuleHandler(false),
        };
        return rule;
      },
    };
  }

  return { selectJsonPath };
}
