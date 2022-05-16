import { Command } from 'commander';
import Path from 'path';
import * as fs from 'fs-extra';

import { tap, forkable, merge } from '../lib/async-tools';
import {
  SpecFacts,
  SpecFile,
  SpecFileOperation,
  OpenAPIV3,
  readDeferencedSpec,
  SpecFilesSourcemap,
} from '../specs';
import { DocumentedBodies } from '../shapes';
import {
  SpecFileOperations,
  SpecPatch,
  SpecPatches,
  SpecFiles,
  SpecFilesAsync,
  BodyExampleFact,
  ComponentSchemaExampleFact,
} from '../specs';
import { Ok, Err, Result } from 'ts-results';

import { flushEvents, trackEvent } from '../segment';
import {
  CapturedInteraction,
  CapturedInteractions,
  HarEntries,
} from '../captures';

export function updateCommand(): Command {
  const command = new Command('update');

  command
    .usage('openapi.yml')
    .argument('<openapi-file>', 'an OpenAPI spec file to update')
    .description(
      'update an OpenAPI specification from examples or observed traffic'
    )
    .action(async (specPath) => {
      const updateResult = await updateByExample(specPath);

      if (updateResult.err) {
        return command.error(updateResult.val);
      }

      let { stats, results: updatedSpecFiles } = updateResult.val;

      for await (let writtenFilePath of SpecFiles.writeFiles(
        updatedSpecFiles
      )) {
        console.log(`Updated ${writtenFilePath}`);
      }

      console.log(
        `✅ Applied ${stats.patchesCount} patch${
          stats.patchesCount === 1 ? '' : 'es'
        } to ${stats.updatedFilesCount} file${
          stats.updatedFilesCount === 1 ? '' : 's'
        } generated from ${stats.examplesCount} example${
          stats.examplesCount === 1 ? '' : 's'
        }`
      );

      trackEvent(
        'openapi_cli.spec_updated_by_example',
        'openapi_cli', // TODO: determine more useful userId
        {
          examplesCount: stats.examplesCount,
          externalExamplesCount: stats.externalExamplesCount,
          patchesCount: stats.patchesCount,
          updatedFilesCount: stats.updatedFilesCount,
          filesWithOverwrittenYamlCommentsCount:
            stats.filesWithOverwrittenYamlComments.size,
        }
      );

      try {
        await flushEvents();
      } catch (err) {
        console.warn('Could not flush usage analytics (non-critical)');
      }
    })
    .addCommand(updateByTrafficCommand());

  return command;
}

export function updateByTrafficCommand(): Command {
  const command = new Command('traffic');

  command
    .usage('openapi.yml')
    .argument('<openapi-file>', 'an OpenAPI spec file to update')
    .description('update an OpenAPI specification from observed traffic')
    .option('--har <har-file>', 'path to HttpArchive file (v1.2, v1.3)')
    .action(async (specPath) => {
      const absoluteSpecPath = Path.resolve(specPath);
      if (!(await fs.pathExists(absoluteSpecPath))) {
        return command.error('OpenAPI specification file could not be found');
      }

      const options = command.opts();

      let interactions: CapturedInteractions | null = null;

      const observers = {
        observeInteraction: tap<CapturedInteraction>((interaction) => {
          console.log('interaction', interaction);
        }),
      };

      if (options.har) {
        let absoluteHarPath = Path.resolve(options.har);
        if (!(await fs.pathExists(absoluteHarPath))) {
          return command.error('Har file could not be found at given path');
        }
        let harFile = fs.createReadStream(absoluteHarPath);
        let harEntries = HarEntries.fromReadable(harFile);
        interactions = observers.observeInteraction(
          CapturedInteractions.fromHarEntries(harEntries)
        );
      }

      if (!interactions) {
        command.showHelpAfterError(true);
        return command.error(
          'Choose a capture method to update spec by traffic'
        );
      }

      const { jsonLike: spec, sourcemap } = await readDeferencedSpec(
        absoluteSpecPath
      );

      let updateResult = await updateByInteractions(
        spec,
        sourcemap,
        interactions
      );

      if (updateResult.err) {
        return command.error(updateResult.val);
      }

      let { results: updatedSpecFiles } = updateResult.val;

      for await (let writtenFilePath of SpecFiles.writeFiles(
        updatedSpecFiles
      )) {
        console.log(`Updated ${writtenFilePath}`);
      }
    });

  return command;
}

export async function updateByExample(specPath: string): Promise<
  Result<
    {
      stats: {
        examplesCount: number;
        externalExamplesCount: number;
        patchesCount: number;
        updatedFilesCount: number;
        filesWithOverwrittenYamlComments: Set<string>;
      };
      results: SpecFilesAsync;
    },
    string
  >
> {
  const absoluteSpecPath = Path.resolve(specPath);
  if (!(await fs.pathExists(absoluteSpecPath))) {
    return Err('OpenAPI specification file could not be found');
  }

  const { jsonLike: spec, sourcemap } = await readDeferencedSpec(
    absoluteSpecPath
  );
  const specFiles = [...SpecFiles.fromSourceMap(sourcemap)];

  const stats = {
    examplesCount: 0,
    externalExamplesCount: 0,
    patchesCount: 0,
    updatedFilesCount: 0,
    filesWithOverwrittenYamlComments: new Set<string>(),
  };
  const observers = {
    observeBodyExamples: tap<BodyExampleFact>((exampleFact) => {
      stats.examplesCount++;
      if (exampleFact.value.externalValue) stats.externalExamplesCount++;
    }),
    observeComponentSchemaExamples: tap<ComponentSchemaExampleFact>(
      (_exampleFact) => {
        stats.examplesCount++;
      }
    ),
    observePatches: tap<SpecPatch>((_patch) => {
      stats.patchesCount++;
    }),
    observeFileOperations: tap<SpecFileOperation>((op) => {
      const file = specFiles.find(({ path }) => path === op.filePath);
      if (file && SpecFile.containsYamlComments(file))
        stats.filesWithOverwrittenYamlComments.add(file.path);
    }),
    observeUpdatedFiles: tap<SpecFile>((_file) => {
      stats.updatedFilesCount++;
    }),
  };

  const facts = forkable(SpecFacts.fromOpenAPISpec(spec));
  const bodyExampleFacts = observers.observeBodyExamples(
    SpecFacts.bodyExamples(facts.fork())
  );
  const componentExampleFacts = observers.observeComponentSchemaExamples(
    SpecFacts.componentSchemaExamples(facts.fork())
  );
  facts.start();

  const exampleBodies = merge(
    DocumentedBodies.fromBodyExampleFacts(bodyExampleFacts, spec),
    DocumentedBodies.fromComponentSchemaExampleFacts(
      componentExampleFacts,
      spec
    )
  );

  // const capturedBodies = // combined from matched bodies and new bodies generated from patches?

  const bodyPatches = SpecPatches.fromDocumentedBodies(exampleBodies);

  // additions only, so we only safely extend the spec
  const specAdditions = observers.observePatches(
    SpecPatches.additions(bodyPatches)
  );

  const fileOperations = observers.observeFileOperations(
    SpecFileOperations.fromSpecPatches(specAdditions, sourcemap)
  );

  const updatedSpecFiles = observers.observeUpdatedFiles(
    SpecFiles.patch(specFiles, fileOperations)
  );

  return Ok({
    stats,
    results: updatedSpecFiles,
  });
}

export async function updateByInteractions(
  spec: OpenAPIV3.Document,
  sourcemap: SpecFilesSourcemap,
  interactions: CapturedInteractions
): Promise<
  Result<
    {
      stats: {};
      results: SpecFilesAsync;
    },
    string
  >
> {
  const specFiles = [...SpecFiles.fromSourceMap(sourcemap)];

  const patches = SpecPatches.fromInteractions(interactions, spec);

  // additions only, so we only safely extend the spec
  const specAdditions = SpecPatches.additions(patches);

  const fileOperations = SpecFileOperations.fromSpecPatches(
    specAdditions,
    sourcemap
  );

  const updatedSpecFiles = SpecFiles.patch(specFiles, fileOperations);

  return Ok({
    stats: {},
    results: updatedSpecFiles,
  });
}
