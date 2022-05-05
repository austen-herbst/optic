import { OperationRule } from './operation-rule';
import { RequestRule } from './request-rule';
import { ResponseRule } from './response-rule';
import { ResponseBodyRule } from './response-body-rule';
import { SpecificationRule } from './specification-rule';
import { RuleContext } from '../types';

export type Rule =
  | SpecificationRule
  | OperationRule
  | RequestRule
  | ResponseRule
  | ResponseBodyRule;

type RulesetConfig = {
  name: string;
  docsLink?: string;
  matches?: (context: RuleContext) => boolean;
  rules: Rule[];
};

export class Ruleset {
  public name: RulesetConfig['name'];
  public docsLink: RulesetConfig['docsLink'];
  public matches: RulesetConfig['matches'];
  public rules: RulesetConfig['rules'];

  constructor(config: RulesetConfig) {
    // this could be invoked via javascript so we still to check
    if (!config.name) {
      throw new Error('Expected a name in Ruleset');
    }
    if (!config.rules) {
      throw new Error('Expected a rules array in Ruleset');
    }
    this.name = config.name;
    this.docsLink = config.docsLink;
    this.matches = config.matches;
    this.rules = config.rules;
  }
}
