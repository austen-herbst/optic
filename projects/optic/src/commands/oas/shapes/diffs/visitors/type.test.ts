import { it, describe, expect } from '@jest/globals';
import { diffBodyBySchema } from '..';
import { SchemaObject } from '../../schema';

describe('type json schema diff visitor', () => {
  const jsonSchema: SchemaObject = {
    type: 'object',
    properties: {
      stringField: { type: 'string' },
    },
  };

  it('when valid, no diff', () => {
    const input = {
      stringField: 'hello-string',
    };
    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toHaveLength(0);
  });

  it('when optional and not provided, no type diff', () => {
    const input = {
      // stringField: "hello-string", // commented to show ommitted
    };
    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toHaveLength(0);
  });

  it('when provided with another primitive', () => {
    const input = {
      stringField: 123,
    };

    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toMatchSnapshot();
  });

  it('when provided with an array', () => {
    const input = {
      stringField: ['1', '2', '3', true],
    };

    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toMatchSnapshot();
  });

  it('when provided with an object', () => {
    const input = {
      stringField: { field: 'string' },
    };

    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toMatchSnapshot();
  });

  it('when provided with null value', () => {
    const input: any = {
      stringField: null,
    };

    const diffs = diffBodyBySchema({ value: input }, jsonSchema);
    expect([...diffs]).toMatchSnapshot();
  });
});
