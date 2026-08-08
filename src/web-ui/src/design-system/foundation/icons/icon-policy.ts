export const SPARO_ICON_OPTICAL_STROKE_WIDTH = {
  compact: 1.25,
  regular: 1.4,
  display: 1.5,
} as const;

export const DESIGN_SYSTEM_ICON_POLICY = {
  preferredPackage: 'lucide-react',
  defaultSize: 16,
  strokeWidth: 1.8,
  iconOnlyButtonRequiresLabel: true,
  customSemanticIcons: [
    'SparoLogoMark',
    'SparoAgentIcon',
    'SparoSubagentIcon',
    'SparoSystemIcon',
  ],
  customSemanticIconRule:
    'Use lucide-react for compact generic actions and objects. Use Sparo semantic icons for first-party brand, agent, system destinations, work types, panel states and layout controls, and large-format navigation, search/filter, file-transfer, or edit/manage actions that need Sparo OS recognition.',
  customSemanticOpticalStrokeWidth: SPARO_ICON_OPTICAL_STROKE_WIDTH,
} as const;
