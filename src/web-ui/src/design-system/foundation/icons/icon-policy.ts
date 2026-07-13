export const DESIGN_SYSTEM_ICON_POLICY = {
  preferredPackage: 'lucide-react',
  defaultSize: 16,
  strokeWidth: 1.8,
  iconOnlyButtonRequiresLabel: true,
  customSemanticIcons: ['SparoLogoMark', 'SparoAgentIcon', 'SparoSubagentIcon'],
  customSemanticIconRule:
    'Use lucide-react for generic actions and objects. Use Sparo semantic icons only for first-party brand and agent concepts that need Sparo OS recognition.',
} as const;
