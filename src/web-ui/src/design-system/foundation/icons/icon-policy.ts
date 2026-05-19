export const DESIGN_SYSTEM_ICON_POLICY = {
  preferredPackage: 'lucide-react',
  defaultSize: 16,
  strokeWidth: 1.8,
  iconOnlyButtonRequiresLabel: true,
  customSemanticIcons: ['SparoAgentIcon', 'SparoSubagentIcon'],
  customSemanticIconRule:
    'Use lucide-react for generic actions and objects. Use Sparo semantic icons only for first-party agent concepts that need Sparo OS brand recognition.',
} as const;
