import {
  JsonSchemaDiffPlugin,
  JsonSchemaKnownKeyword,
  JsonSchemaPatch,
  JsonSchemaPatchClassification,
} from './plugin-types';
import { ErrorObject } from 'ajv';
import { ConceptualLocation, OpenAPIV3 } from '@useoptic/openapi-utilities';
import { JsonSchemaJsonDiffer } from '../types';
import { BodyPropertyUnmatchedType, DiffType } from '../../../types';
import {
  JsonPatcher,
  jsonPatcher,
} from '../../../../patch/incremental-json-patch/json-patcher';
import { streamingJsonSchemaBuilder } from '../json-builder/streaming-json-schema-builder';
import { jsonPointerHelpers } from '@useoptic/json-pointer-helpers';
import { allowedKeysForOneOf } from '../transition-assumptions';

export const oneOfKeyword: JsonSchemaDiffPlugin<BodyPropertyUnmatchedType> = {
  keyword: JsonSchemaKnownKeyword.oneOf,
  emitDiff(
    schemaPath: string,
    validationError: ErrorObject,
    example: any,
    conceptualLocation: ConceptualLocation
  ): BodyPropertyUnmatchedType {
    const typeKeywordPath = jsonPointerHelpers.decode(
      validationError.schemaPath.substring(1)
    );

    const oneOfIndex = jsonPointerHelpers
      .compile(typeKeywordPath)
      .lastIndexOf('oneOf');

    const propertyPath = jsonPointerHelpers.compile(
      typeKeywordPath.slice(0, oneOfIndex + 1)
    );

    const keyName = jsonPointerHelpers.decode(propertyPath).pop() || '';

    const unmatchedValue = jsonPointerHelpers.get(
      example,
      validationError.instancePath
    );

    return {
      schemaPath,
      type: DiffType.BodyUnmatchedType,
      keyword: JsonSchemaKnownKeyword.oneOf,
      location: conceptualLocation,
      propertyPath: propertyPath,
      key: keyName,
      example: unmatchedValue,
    };
  },
  shapePatches(
    diff: BodyPropertyUnmatchedType,
    differ: JsonSchemaJsonDiffer,
    patcher: JsonPatcher<OpenAPIV3.Document>
  ): JsonSchemaPatch[] {
    const schema = jsonPatcher(patcher.helper.get(diff.schemaPath));

    const expandOneOf = () => {
      const patch = schema.fork();

      patch.apply(`add new oneOf type to ${diff.key}`, [
        {
          op: 'add',
          path: jsonPointerHelpers.append(diff.propertyPath, 'oneOf', '-'), // "-" indicates append to array
          value: streamingJsonSchemaBuilder(differ, diff.example),
        },
      ]);

      patch.helper.removeKeysNotAllowedAt(
        diff.propertyPath,
        allowedKeysForOneOf,
        'after changing to a oneOf'
      );

      const effect = `expand one of for ${diff.key}`;
      return {
        classification: diff.location.inRequest
          ? JsonSchemaPatchClassification.Compatible
          : JsonSchemaPatchClassification.Incompatible,
        patch: patch.currentPatchesRelativeTo(diff.schemaPath),
        effect: effect,
        extends: true,
      };
    };

    return [expandOneOf()];
  },
};
