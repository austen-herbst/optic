import { DocsLinkHelper, Result, runCheck } from "./types";
import { IChange } from "@useoptic/openapi-utilities/build/openapi3/sdk/types";

export class Checker {
  private checkResults: Result[] = [];
  async runCheck(
    change: IChange<any>,
    docsLink: DocsLinkHelper,
    where: string,
    condition: string,
    must: boolean,
    handler: (() => void) | (() => Promise<void>)
  ) {
    this.checkResults.push(
      await runCheck(change, docsLink, where, condition, must, handler)
    );
  }

  listResults() {
    return this.checkResults;
  }
}
