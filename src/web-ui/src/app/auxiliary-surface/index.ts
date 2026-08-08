export {
  selectActiveAuxiliaryHostState,
  useAuxiliarySurfaceStore,
} from './auxiliarySurfaceStore';
export { AuxiliarySurfaceCoordinator } from './AuxiliarySurfaceCoordinator';
export {
  collapseActiveAuxiliarySurface,
  enterActiveAuxiliarySceneFocus,
  exitActiveAuxiliarySceneFocus,
  flushAuxiliaryItems,
  openActiveAuxiliaryItem,
  openActiveAuxiliaryItemAtPresentation,
  openAuxiliaryItem,
  registerAuxiliarySurfaceRestorer,
  resizeActiveAuxiliarySurface,
  toggleActiveAuxiliarySurface,
} from './controller';
export {
  auxiliaryHostKeysForSession,
  homeAuxiliaryHostKey,
  resolveAuxiliaryHostKey,
  sessionAuxiliaryHostKey,
} from './host';
export {
  forgetSessionAuxiliarySurfaces,
  synchronizeAuxiliarySurface,
} from './navigationSync';
export type {
  AuxiliaryItemDescriptor,
  AuxiliarySurfaceDefaultVisibility,
  AuxiliarySurfaceHostKey,
  AuxiliarySurfaceHostState,
  AuxiliarySurfacePresentation,
  AuxiliarySurfaceReveal,
  AuxiliarySurfaceUserDisposition,
  OpenAuxiliaryItemCommand,
} from './types';
