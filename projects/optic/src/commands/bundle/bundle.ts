import { Command } from 'commander';
import { ParseResult, getFileFromFsOrGit } from '../../utils/spec-loaders';
import { OpticCliConfig } from '../../config';
import {
  FlatOpenAPIV3,
  OpenAPIV3,
  UserError,
} from '@useoptic/openapi-utilities';
import { isYaml, JsonSchemaSourcemap, writeYaml } from '@useoptic/openapi-io';
import fs from 'node:fs/promises';
import path from 'path';

import { errorHandler } from '../../error-handler';
import { jsonPointerHelpers } from '@useoptic/json-pointer-helpers';
import slugify from 'slugify';
import { Operation } from 'fast-json-patch';
import * as jsonpatch from 'fast-json-patch';
import sortby from 'lodash.sortby';
const description = `dereference an OpenAPI specification`;

const usage = () => `
  optic bundle <file_path>
  optic bundle <file_path> > dereference.yml
`;
const helpText = `
Example usage:
  $ optic bundle openapi-spec.yml > bundled.yml
  `;

export const registerBundle = (cli: Command, config: OpticCliConfig) => {
  cli
    .command('bundle')
    .configureHelp({
      commandUsage: usage,
    })
    .addHelpText('after', helpText)
    .description(description)
    .argument('[file_path]', 'openapi file to bundle')
    .option('-o [output]', 'output file name')
    .action(errorHandler(bundleAction(config)));
};

const getSpec = async (
  file1: string,
  config: OpticCliConfig
): Promise<ParseResult> => {
  try {
    // TODO update function to try download from spec-id cloud
    return getFileFromFsOrGit(file1, config, {
      strict: false,
      denormalize: false,
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    throw new UserError();
  }
};

const bundleAction =
  (config: OpticCliConfig) => async (filePath: string | undefined, options) => {
    const { o } = options;

    let parsedFile: ParseResult;
    if (filePath) {
      parsedFile = await getSpec(filePath, config);

      const updatedSpec = bundle(parsedFile.jsonLike, parsedFile.sourcemap);

      if (o) {
        // write to file
        const outputPath = path.resolve(o);
        await fs.writeFile(
          outputPath,
          isYaml(o)
            ? writeYaml(updatedSpec)
            : JSON.stringify(updatedSpec, null, 2)
        );
        console.log('wrote bundled spec to ' + path.resolve(o));
      } else {
        // assume pipe >
        if (isYaml(filePath)) {
          console.log(writeYaml(updatedSpec));
        } else {
          console.log(JSON.stringify(updatedSpec, null, 2));
        }
      }
    } else {
      console.error('No specification found');
      process.exitCode = 1;
      return;
    }
  };

const methods = `{get,post,put,delete,patch,head,options}`;
const matches = {
  inResponseSchema: [
    'paths',
    '**',
    methods,
    'responses',
    '**',
    'content',
    '**/**',
    'schema',
  ],
  inRequestSchema: [
    'paths',
    '**',
    methods,
    'requestBody',
    'content',
    '**/**',
    'schema',
  ],
  inOperationParameter: ['paths', '**', methods, 'parameters', '**'],
  inPathParameter: ['paths', '**', 'parameters', '**'],
  inRequestExamples: [
    'paths',
    '**',
    methods,
    'requestBody',
    'content',
    '**/**',
    'examples',
    '**',
  ],
  inResponseExamples: [
    'paths',
    '**',
    methods,
    'responses',
    '**',
    'content',
    '**/**',
    'examples',
    '**',
  ],
  inRequestExample: [
    'paths',
    '**',
    methods,
    'requestBody',
    'content',
    '**/**',
    'example',
  ],
  inResponseExample: [
    'paths',
    '**',
    methods,
    'responses',
    '**',
    'content',
    '**/**',
    'example',
  ],
};
function bundle(spec: OpenAPIV3.Document, sourcemap: JsonSchemaSourcemap) {
  // create empty component objects if they do not exist
  if (!spec.components) spec.components = {};
  if (!spec.components.schemas) spec.components.schemas = {};
  if (!spec.components.parameters) spec.components.parameters = {};
  if (!spec.components.examples) spec.components.examples = {};

  let updatedSpec = spec;

  // handle schemas
  updatedSpec = bundleMatchingRefsAsComponents<OpenAPIV3.SchemaObject>(
    updatedSpec,
    sourcemap,
    [matches.inRequestSchema, matches.inResponseSchema],
    jsonPointerHelpers.compile(['components', 'schemas']),
    (schema) => schema.title
  );

  // handle parameters
  updatedSpec = bundleMatchingRefsAsComponents(
    updatedSpec,
    sourcemap,
    [matches.inPathParameter, matches.inOperationParameter],
    jsonPointerHelpers.compile(['components', 'parameters']),
    (parameter) => `${parameter.name}_${parameter.in}`
  );

  // handle examples
  updatedSpec = bundleMatchingRefsAsComponents(
    updatedSpec,
    sourcemap,
    [
      matches.inRequestExample,
      matches.inRequestExamples,
      matches.inResponseExample,
      matches.inResponseExamples,
    ],
    jsonPointerHelpers.compile(['components', 'examples']),
    (example) => ''
  );

  return updatedSpec;
}

function bundleMatchingRefsAsComponents<T>(
  spec: OpenAPIV3.Document,
  sourcemap: JsonSchemaSourcemap,
  matchers: string[][],
  targetPath: string,
  naming: (T) => string
) {
  const rootFileIndex = sourcemap.files.find(
    (i) => i.path === sourcemap.rootFilePath
  )!.index;

  // find all $ref usages that match the target pattern ie. in a schema?
  const matchingKeys = Object.keys(sourcemap.refMappings).filter(
    (flatSpecPath) => {
      return matchers.some((matcher) => {
        return (
          jsonPointerHelpers.startsWith(flatSpecPath, matcher) ||
          jsonPointerHelpers.matches(flatSpecPath, matcher)
        );
      });
    }
  );

  // build a set of used names -- we don't want conflicts since the namespace is the components.{} object
  const existingComponents = jsonPointerHelpers.tryGet(spec, targetPath);
  const usedNames = new Set<string>(
    existingComponents.match
      ? (Object.keys(existingComponents.value) as string[])
      : []
  );

  // when new components are made, ensure the name is unique. If it's not unique try incrementing `_#` until it is.
  const leaseComponentPath = (name: string): string => {
    let componentName = name;
    let trailingNumber = 0;
    while (usedNames.has(componentName)) {
      componentName = name + '_' + trailingNumber;
      trailingNumber++;
    }

    usedNames.add(componentName);
    return jsonPointerHelpers.append(targetPath, componentName);
  };

  const refs: {
    [key: string]: {
      component: any;
      componentPath: string;
      originalPath: string;
      skipAddingToComponents: boolean;
      usages: string[];
    };
  } = {};

  const addComponentOperations: Operation[] = [];
  const updateUsagesOperations: Operation[] = [];

  matchingKeys.forEach((key) => {
    const mapping = sourcemap.refMappings[key];
    const refKey = `${mapping[0].toString()}-${mapping[1]}`;
    // if the $ref has already been named, add a usage
    if (refs.hasOwnProperty(refKey)) {
      const foundRef = refs[refKey];
      foundRef.usages.push(key);
    } else {
      // if the $ref has never been seen before, add it and compute a free name
      const component = jsonPointerHelpers.get(spec, key);
      const decodedKey = jsonPointerHelpers.decode(key);
      const nameOptions =
        naming(component as T) ||
        slugify(decodedKey.join('_'), { replacement: '_', lower: true }) ||
        decodedKey[decodedKey.length - 1];

      // this checks if the component is already in the root file of the spec
      const isAlreadyInPlace = refKey.startsWith(
        `${rootFileIndex}-${targetPath}`
      );

      refs[refKey] = {
        skipAddingToComponents: isAlreadyInPlace,
        originalPath: key,
        componentPath: isAlreadyInPlace
          ? targetPath
          : leaseComponentPath(nameOptions),
        component,
        usages: [key],
      };
    }
  });

  const refArray = Object.values(refs);
  // second pass: Nested schemas. Patch the new components we've created that rely on other newly created components.
  refArray.forEach((ref) => {
    const nestedRefs = refArray.filter((i) =>
      i.usages.some((i) => i.startsWith(ref.originalPath))
    );

    const nestedRefUsageUpdates: Operation[] = [];
    nestedRefs.forEach((nestedRef) => {
      nestedRef.usages
        .filter((i) => i.startsWith(ref.originalPath) && i !== ref.originalPath)
        .map((i) => i.split(ref.originalPath)[1])
        .forEach((i) => {
          nestedRefUsageUpdates.push({
            op: 'replace',
            path: i,
            value: { $ref: '#' + nestedRef.componentPath },
          });
        });

      nestedRef.usages = nestedRef.usages.filter(
        (i) => !(i.startsWith(ref.originalPath) && i !== ref.originalPath)
      );
    });
    const copy = JSON.parse(JSON.stringify(ref.component));
    jsonpatch.applyPatch(copy, nestedRefUsageUpdates, true);
    ref.component = copy;
  });

  // now generate the actual spec patches
  refArray.forEach((ref) => {
    if (!ref.skipAddingToComponents)
      addComponentOperations.push({
        op: 'add',
        path: ref.componentPath,
        value: ref.component,
      });

    ref.usages.forEach((usage) => {
      updateUsagesOperations.push({
        op: 'replace',
        path: usage,
        value: {
          $ref: '#' + ref.componentPath,
        },
      });
    });
  });

  // add components first
  let specCopy = JSON.parse(JSON.stringify(spec));
  jsonpatch.applyPatch(specCopy, addComponentOperations, true);

  // then add $refs in reverse depth order (to prevent conflicts).
  const sortedUpdateOperations = sortby(
    updateUsagesOperations,
    (op) => jsonPointerHelpers.decode(op.path).length
  );

  jsonpatch.applyPatch(specCopy, sortedUpdateOperations, true);

  return specCopy;
}
