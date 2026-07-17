
// Core Configuration Module Exports


export {
  getAllTemplates,
  getFormatDisplayName,
  PROVIDER_TEMPLATES
} from './modelConfigs';


export {
  aiExperienceConfigService,
} from './AIExperienceConfigService';
export { BUILTIN_SPARKY_COMPANION_PET } from './AgentCompanionPetService';




export type {
  ModelConfig,
  ProviderTemplate,
  ApiFormat
} from '../../../shared/types';

export type {
  AgentCompanionPetSelection,
  AIExperienceSettings,
} from './AIExperienceConfigService';


