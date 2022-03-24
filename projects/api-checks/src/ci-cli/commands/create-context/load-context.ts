import { NormalizedCiContext } from '../../types';
import { loadFile, normalizeCiContext } from '../utils';
import { UserError } from '../../errors';
import path from 'path';
import { DEFAULT_CONTEXT_PATH } from '../constants';

export async function loadCiContext(
  ciProvider: 'github' | 'circleci',
  ciContext?: string
): Promise<NormalizedCiContext | undefined> {
  let normalizedCiContext: NormalizedCiContext;
  if (ciContext) {
    // Legacy flow
    // https://github.com/opticdev/issues/issues/236 - to deprecate
    try {
      const contextFileBuffer = await loadFile(ciContext);
      normalizedCiContext = normalizeCiContext(ciProvider, contextFileBuffer);
    } catch (e) {
      console.error(e);
      return undefined;
    }
  } else {
    console.log(
      `Attempting to read context from default context path ${path.join(
        process.cwd(),
        DEFAULT_CONTEXT_PATH
      )}`
    );

    // New flow - implicit assumption of using `optic-ci create-context`;
    // TODO also allow users to specify the paths - also requires validation
    try {
      const contextFileBuffer = await loadFile(DEFAULT_CONTEXT_PATH);
      normalizedCiContext = JSON.parse(contextFileBuffer.toString());
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }
  return normalizedCiContext;
}
