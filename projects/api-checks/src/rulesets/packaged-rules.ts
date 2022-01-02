import { breakingChanges } from './breaking-changes/service';
import { OpticCINamedRulesets } from '../sdk/ruleset';
import { ApiCheckService } from '../sdk/api-check-service';
import { namingRules } from './naming/service';

export const packagedRules: {
  breaking: ApiCheckService<any>;
} & OpticCINamedRulesets = {
  // make sure these keys are snake case / CLI friendly
  default: breakingChanges(),
  breaking: breakingChanges(),
};

export const standards = {
  breakingChanges,
  namingRules,
};
