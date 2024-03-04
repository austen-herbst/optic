import { RuleContext, Ruleset, SpectralRule } from '@useoptic/rulesets-base';
import Ajv from 'ajv';
import {
  IChange,
  IFact,
  ObjectDiff,
  FlatOpenAPIV3,
  FlatOpenAPIV3_1,
  Result,
  RuleResult,
} from '@useoptic/openapi-utilities';
import { ExternalRuleBase } from '@useoptic/rulesets-base/build/rules/external-rule-base';
import path from 'path';
import os from 'os';
import fs from 'node:fs/promises';
import { OpenAPIFactNodes } from '@useoptic/rulesets-base/build/rule-runner/rule-runner-types';
import { excludeOperationWithExtensionMatches } from '../utils';

type RulesetConfig = {
  exclude_operations_with_extension?: string | string[];
  added?: string[];
  always?: string[];
  changed?: string[];
  addedOrChanged?: string[];
  docs_link?: string;
};

const ajv = new Ajv();
const configSchema = {
  type: 'object',
  properties: {
    exclude_operations_with_extension: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
    added: {
      type: 'array',
      items: {
        type: 'string',
        description: 'URI of spectral ruleset file (file or URL)',
      },
    },
    always: {
      type: 'array',
      items: {
        type: 'string',
        description: 'URI of spectral ruleset file (file or URL)',
      },
    },
    changed: {
      type: 'array',
      items: {
        type: 'string',
        description: 'URI of spectral ruleset file (file or URL)',
      },
    },
    addedOrChanged: {
      type: 'array',
      items: {
        type: 'string',
        description: 'URI of spectral ruleset file (file or URL)',
      },
    },
  },
};
const validateConfigSchema = ajv.compile(configSchema);

export class SpectralRulesets extends ExternalRuleBase {
  private options: {
    always: string[];
    added: string[];
    changed: string[];
    addedOrChanged: string[];
    matches?: (context: RuleContext) => boolean;
  };
  constructor(options: {
    always?: string[];
    added?: string[];
    changed?: string[];
    addedOrChanged?: string[];
    matches?: (context: RuleContext) => boolean;
  }) {
    super();
    this.options = {
      always: options.always ?? [],
      added: options.added ?? [],
      changed: options.changed ?? [],
      addedOrChanged: options.addedOrChanged ?? [],
      matches: options.matches,
    };
  }

  async runRules(inputs: {
    context: any;
    nextFacts: IFact[];
    currentFacts: IFact[];
    changelog: IChange[];
    nextJsonLike: FlatOpenAPIV3.Document | FlatOpenAPIV3_1.Document;
    currentJsonLike: FlatOpenAPIV3.Document | FlatOpenAPIV3_1.Document;
    groupedFacts: OpenAPIFactNodes;
  }): Promise<Result[]> {
    const absolutePathTmpSpec = path.join(
      os.tmpdir(),
      `optic-next-spec-${Math.floor(Math.random() * 100000)}.json`
    );

    // write one tmp spec for all the spectral runs to use
    await fs.writeFile(
      absolutePathTmpSpec,
      JSON.stringify(inputs.nextJsonLike)
    );

    const added = this.options.added.map((ruleInput) => {
      return new SpectralRule({
        name:
          'Spectral Rules applied to additions to the specification: ' +
          ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'added',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });
    const changed = this.options.changed.map((ruleInput) => {
      return new SpectralRule({
        name:
          'Spectral Rules applied to changes to the specification: ' +
          ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'changed',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });
    const addedOrChanged = this.options.addedOrChanged.flatMap((ruleInput) => {
      return [
        new SpectralRule({
          name:
            'Spectral Rules applied to additions to the specification: ' +
            ruleInput,
          flatSpecFile: absolutePathTmpSpec,
          applies: 'added',
          rulesetPointer: ruleInput,
          matches: this.options.matches,
        }),
        new SpectralRule({
          name:
            'Spectral Rules applied to changes to the specification: ' +
            ruleInput,
          flatSpecFile: absolutePathTmpSpec,
          applies: 'changed',
          rulesetPointer: ruleInput,
          matches: this.options.matches,
        }),
      ];
    });
    const always = this.options.always.map((ruleInput) => {
      return new SpectralRule({
        name: 'Spectral Rules applied to entire specification: ' + ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'always',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });

    const allRulesets = [...always, ...added, ...changed, ...addedOrChanged];

    const allResults = await Promise.all(
      allRulesets.map((ruleset) => ruleset.runRules(inputs))
    );

    // remove tmp spec
    await fs.unlink(absolutePathTmpSpec);

    return allResults.flat(1);
  }

  async runRulesV2(inputs: {
    context: any;
    diffs: ObjectDiff[];
    fromSpec: FlatOpenAPIV3.Document | FlatOpenAPIV3_1.Document;
    toSpec: FlatOpenAPIV3.Document | FlatOpenAPIV3_1.Document;
    groupedFacts: OpenAPIFactNodes;
  }): Promise<RuleResult[]> {
    const absolutePathTmpSpec = path.join(
      os.tmpdir(),
      `optic-next-spec-${Math.floor(Math.random() * 100000)}.json`
    );

    // write one tmp spec for all the spectral runs to use
    await fs.writeFile(absolutePathTmpSpec, JSON.stringify(inputs.toSpec));

    const added = this.options.added.map((ruleInput) => {
      return new SpectralRule({
        name:
          'Spectral Rules applied to additions to the specification: ' +
          ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'added',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });
    const always = this.options.always.map((ruleInput) => {
      return new SpectralRule({
        name: 'Spectral Rules applied to entire specification: ' + ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'always',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });
    const changed = this.options.changed.map((ruleInput) => {
      return new SpectralRule({
        name:
          'Spectral Rules applied to changes to the specification: ' +
          ruleInput,
        flatSpecFile: absolutePathTmpSpec,
        applies: 'changed',
        rulesetPointer: ruleInput,
        matches: this.options.matches,
      });
    });
    const addedOrChanged = this.options.addedOrChanged.flatMap((ruleInput) => {
      return [
        new SpectralRule({
          name:
            'Spectral Rules applied to additions to the specification: ' +
            ruleInput,
          flatSpecFile: absolutePathTmpSpec,
          applies: 'added',
          rulesetPointer: ruleInput,
          matches: this.options.matches,
        }),
        new SpectralRule({
          name:
            'Spectral Rules applied to changes to the specification: ' +
            ruleInput,
          flatSpecFile: absolutePathTmpSpec,
          applies: 'changed',
          rulesetPointer: ruleInput,
          matches: this.options.matches,
        }),
      ];
    });

    const allRulesets = [...always, ...added, ...changed, ...addedOrChanged];

    const allResults = await Promise.all(
      allRulesets.map((ruleset) => ruleset.runRulesV2(inputs))
    );

    // remove tmp spec
    await fs.unlink(absolutePathTmpSpec);

    return allResults.flat(1);
  }

  static async fromOpticConfig(
    config: unknown
  ): Promise<SpectralRulesets | string> {
    const result = validateConfigSchema(config);

    if (!result && validateConfigSchema.errors) {
      return validateConfigSchema.errors
        .map((error) => {
          return `- ruleset/spectral${error.instancePath} ${error.message}`;
        })
        .join('\n- ');
    }
    const validatedConfig = config as RulesetConfig;
    let matches: Ruleset['matches'] | undefined = undefined;

    if (validatedConfig.exclude_operations_with_extension !== undefined) {
      matches = excludeOperationWithExtensionMatches(
        validatedConfig.exclude_operations_with_extension
      );
    }

    return new SpectralRulesets({
      added: validatedConfig.added ?? [],
      always: validatedConfig.always ?? [],
      changed: validatedConfig.changed ?? [],
      addedOrChanged: validatedConfig.addedOrChanged ?? [],
      matches,
    });
  }
}
