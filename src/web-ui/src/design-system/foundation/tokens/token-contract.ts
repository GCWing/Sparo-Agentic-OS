export type DesignTokenScale = Record<string | number, string>;
export type DesignTokenValueScale = Record<string | number, string | number>;
export interface ThemeColorScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
}

export interface ThemeBrandColors {
  core: string;
  action: string;
  actionHover: string;
  actionActive: string;
  onAction: string;
  focusRing: string;
}

export interface ThemeColorConfig {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    quaternary: string;
    elevated: string;
    workbench: string;
    scene: string;
    tooltip?: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    disabled: string;
  };
  border: {
    subtle: string;
    base: string;
    medium: string;
    strong: string;
    prominent: string;
  };
  element: {
    subtle: string;
    soft: string;
    base: string;
    medium: string;
    strong: string;
    elevated: string;
  };
  brand?: ThemeBrandColors;
  accent: ThemeColorScale;
  purple?: ThemeColorScale;
  semantic: {
    success: string;
    successBg: string;
    successBorder: string;
    warning: string;
    warningBg: string;
    warningBorder: string;
    error: string;
    errorBg: string;
    errorBorder: string;
    info: string;
    infoBg: string;
    infoBorder: string;
    highlight: string;
    highlightBg: string;
  };
  git: {
    branch: string;
    branchBg: string;
    changes: string;
    changesBg: string;
    added: string;
    addedBg: string;
    deleted: string;
    deletedBg: string;
    staged: string;
    stagedBg: string;
  };
  scrollbar?: {
    thumb?: string;
    thumbHover?: string;
  };
}

export interface ThemeEffectsConfig {
  spacing: object;
  radius: {
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl'?: string;
    full: string;
  };
  shadow: object;
  blur: object;
  glow: {
    blue: string;
    purple: string;
    mixed: string;
  };
  opacity: {
    disabled: string | number;
    hover: string | number;
    focus: string | number;
    overlay: string | number;
  };
}

export interface ThemeMotionConfig {
  duration: object;
  easing: object;
}

export interface ThemeTypographyConfig {
  font: {
    sans: string;
    mono: string;
  };
  size: object;
  weight: object;
  lineHeight: object;
}

export interface ThemeComponentStateConfig {
  background: string;
  color: string;
  border: string;
  shadow?: string;
  transform?: string;
}

export interface ThemeButtonComponentConfig {
  default: ThemeComponentStateConfig;
  hover: ThemeComponentStateConfig;
  active: ThemeComponentStateConfig;
  primary: {
    default: ThemeComponentStateConfig;
    hover: ThemeComponentStateConfig;
    active: ThemeComponentStateConfig;
  };
  ghost: {
    default: ThemeComponentStateConfig;
    hover: ThemeComponentStateConfig;
    active: ThemeComponentStateConfig;
  };
}

export interface ThemeWindowControlStateConfig {
  dot: string;
  dotShadow?: string;
  hoverBg: string;
  hoverColor: string;
  hoverBorder: string;
  hoverShadow?: string;
}

export interface ThemeWindowControlsConfig {
  minimize: ThemeWindowControlStateConfig;
  maximize: ThemeWindowControlStateConfig;
  close: ThemeWindowControlStateConfig;
  common: {
    defaultColor: string;
    defaultDot: string;
    disabledDot: string;
    flowGradient?: string;
  };
}

export interface ThemeConfig {
  type: 'dark' | 'light' | string;
  colors: ThemeColorConfig;
  effects: ThemeEffectsConfig;
  motion: ThemeMotionConfig;
  typography: ThemeTypographyConfig;
  components?: {
    button?: ThemeButtonComponentConfig;
    windowControls?: ThemeWindowControlsConfig;
  };
  layout?: {
    sceneViewportBorder?: boolean;
  };
}

export interface DesignStatusToken {
  fg: string;
  bg: string;
  border: string;
}

export interface DesignInteractiveToken {
  fg: string;
  bg: string;
  border: string;
  hoverBg: string;
  activeBg: string;
}

export interface DesignTokens {
  color: {
    bg: {
      app: string;
      scene: string;
      panel: string;
      elevated: string;
      overlay: string;
      tooltip: string;
    };
    text: {
      primary: string;
      secondary: string;
      muted: string;
      disabled: string;
      inverse: string;
    };
    border: {
      subtle: string;
      base: string;
      medium: string;
      strong: string;
      prominent: string;
      focus: string;
    };
    element: {
      subtle: string;
      soft: string;
      base: string;
      medium: string;
      strong: string;
      elevated: string;
    };
    brand: ThemeBrandColors;
    accent: DesignTokenScale;
    purple: DesignTokenScale;
    success: DesignStatusToken;
    warning: DesignStatusToken;
    danger: DesignStatusToken;
    info: DesignStatusToken;
    overlay: {
      scrim: string;
      scrimStrong: string;
      backdrop: string;
    };
    focus: {
      ring: string;
      ringSubtle: string;
      outline: string;
    };
    selection: {
      bg: string;
      fg: string;
      inactiveBg: string;
    };
    shadowColor: {
      subtle: string;
      soft: string;
      card: string;
      floating: string;
      popover: string;
      modal: string;
      strong: string;
      text: string;
    };
    diff: {
      added: DesignStatusToken;
      deleted: DesignStatusToken;
      modified: DesignStatusToken;
      unchanged: DesignStatusToken;
      gutter: {
        added: string;
        deleted: string;
        modified: string;
      };
    };
    terminal: {
      bg: string;
      fg: string;
      muted: string;
      prompt: string;
      cursor: string;
      selection: string;
      success: string;
      warning: string;
      danger: string;
    };
    syntax: {
      keyword: string;
      string: string;
      number: string;
      function: string;
      type: string;
      variable: string;
      constant: string;
      operator: string;
      comment: string;
      punctuation: string;
    };
    language: Record<
      'typescript' | 'javascript' | 'json' | 'markdown' | 'rust' | 'css' | 'html' | 'shell' | 'python',
      DesignStatusToken
    >;
    toolFamily: Record<
      'agent' | 'code' | 'files' | 'terminal' | 'git' | 'search' | 'browser' | 'design',
      DesignStatusToken
    >;
    markdown: {
      link: string;
      inlineCode: DesignStatusToken;
      codeBlock: DesignStatusToken;
      blockquote: DesignStatusToken;
      table: {
        headerBg: string;
        border: string;
        rowHoverBg: string;
      };
      hr: string;
    };
    statusSurface: {
      neutral: DesignStatusToken;
      success: DesignStatusToken;
      warning: DesignStatusToken;
      danger: DesignStatusToken;
      info: DesignStatusToken;
      running: DesignStatusToken;
      pending: DesignStatusToken;
    };
  };
  space: DesignTokenScale;
  radius: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
    full: string;
  };
  typography: {
    family: {
      sans: string;
      mono: string;
    };
    size: DesignTokenScale;
    weight: Record<string, number>;
    lineHeight: Record<string, number>;
  };
  shadow: DesignTokenScale;
  motion: {
    duration: DesignTokenScale;
    easing: Record<string, string>;
  };
  zIndex: {
    underlay: number;
    base: number;
    local: number;
    raised: number;
    header: number;
    sticky: number;
    floating: number;
    dropdown: number;
    scrim: number;
    overlay: number;
    drawer: number;
    dialog: number;
    fullscreen: number;
    toast: number;
    popover: number;
    tooltip: number;
    notification: number;
    contextMenu: number;
  };
}

function stringScale(scale: object): DesignTokenScale {
  return Object.fromEntries(
    Object.entries(scale).map(([key, value]) => [key, String(value)])
  );
}

function numberRecord(scale: object): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scale).map(([key, value]) => [key, Number(value)])
  );
}

function status(fg: string, bg: string, border: string): DesignStatusToken {
  return { fg, bg, border };
}

export function createDesignTokens(theme: ThemeConfig): DesignTokens {
  const { colors, effects, motion, typography } = theme;
  const isDark = theme.type === 'dark';
  const brand: ThemeBrandColors = colors.brand ?? {
    core: colors.accent[500],
    action: colors.accent[500],
    actionHover: colors.accent[600],
    actionActive: colors.accent[800],
    onAction: '#ffffff',
    focusRing: colors.accent[500],
  };
  const purple = colors.purple ?? colors.accent;
  const neutralSurface = status(colors.text.secondary, colors.element.base, colors.border.base);
  const runningSurface = status(colors.accent[500], colors.accent[100], colors.accent[300]);

  return {
    color: {
      bg: {
        app: colors.background.primary,
        scene: colors.background.scene,
        panel: colors.background.secondary,
        elevated: colors.background.elevated,
        overlay: theme.type === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)',
        tooltip: colors.background.tooltip ?? colors.background.elevated,
      },
      text: {
        primary: colors.text.primary,
        secondary: colors.text.secondary,
        muted: colors.text.muted,
        disabled: colors.text.disabled,
        // `text.inverse` is the foreground color used on accent / dark / inverted
        // surfaces (primary buttons, accent badges, status chips, terminal prompt,
        // etc.). Every consumer in this product pairs it with a saturated accent
        // or dark fill, so it must resolve to a contrast-safe light value in both
        // themes regardless of the active body text color. Returning the dark
        // body color here in light theme produced unreadable "red background +
        // dark text" buttons (see app-detail dirty-bar, mode pills, AIModelConfig
        // badges, feature modal, etc.).
        inverse: '#ffffff',
      },
      border: {
        ...colors.border,
        focus: brand.focusRing,
      },
      element: colors.element,
      brand,
      accent: stringScale(colors.accent),
      purple: stringScale(colors.purple ?? colors.accent),
      success: {
        fg: colors.semantic.success,
        bg: colors.semantic.successBg,
        border: colors.semantic.successBorder,
      },
      warning: {
        fg: colors.semantic.warning,
        bg: colors.semantic.warningBg,
        border: colors.semantic.warningBorder,
      },
      danger: {
        fg: colors.semantic.error,
        bg: colors.semantic.errorBg,
        border: colors.semantic.errorBorder,
      },
      info: {
        fg: colors.semantic.info,
        bg: colors.semantic.infoBg,
        border: colors.semantic.infoBorder,
      },
      overlay: {
        scrim: isDark ? 'rgba(0, 0, 0, 0.56)' : 'rgba(15, 23, 42, 0.34)',
        scrimStrong: isDark ? 'rgba(0, 0, 0, 0.72)' : 'rgba(15, 23, 42, 0.48)',
        backdrop: isDark ? 'rgba(10, 10, 12, 0.78)' : 'rgba(248, 250, 252, 0.78)',
      },
      focus: {
        ring: brand.focusRing,
        ringSubtle: brand.action,
        outline: brand.focusRing,
      },
      selection: {
        bg: colors.semantic.highlightBg || colors.accent[200],
        fg: colors.text.primary,
        inactiveBg: colors.accent[100],
      },
      shadowColor: {
        subtle: isDark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(15, 23, 42, 0.06)',
        soft: isDark ? 'rgba(0, 0, 0, 0.24)' : 'rgba(15, 23, 42, 0.08)',
        card: isDark ? 'rgba(0, 0, 0, 0.32)' : 'rgba(15, 23, 42, 0.10)',
        floating: isDark ? 'rgba(0, 0, 0, 0.40)' : 'rgba(15, 23, 42, 0.14)',
        popover: isDark ? 'rgba(0, 0, 0, 0.44)' : 'rgba(15, 23, 42, 0.16)',
        modal: isDark ? 'rgba(0, 0, 0, 0.52)' : 'rgba(15, 23, 42, 0.22)',
        strong: isDark ? 'rgba(0, 0, 0, 0.60)' : 'rgba(15, 23, 42, 0.28)',
        text: isDark ? 'rgba(0, 0, 0, 0.50)' : 'rgba(15, 23, 42, 0.18)',
      },
      diff: {
        added: status(colors.git.added, colors.git.addedBg, colors.semantic.successBorder),
        deleted: status(colors.git.deleted, colors.git.deletedBg, colors.semantic.errorBorder),
        modified: status(colors.git.changes, colors.git.changesBg, colors.semantic.warningBorder),
        unchanged: neutralSurface,
        gutter: {
          added: colors.git.added,
          deleted: colors.git.deleted,
          modified: colors.git.changes,
        },
      },
      terminal: {
        bg: colors.background.primary,
        fg: colors.text.primary,
        muted: colors.text.muted,
        prompt: colors.accent[500],
        cursor: colors.accent[500],
        selection: colors.accent[200],
        success: colors.semantic.success,
        warning: colors.semantic.warning,
        danger: colors.semantic.error,
      },
      syntax: {
        keyword: purple[500],
        string: colors.semantic.success,
        number: colors.semantic.warning,
        function: colors.accent[500],
        type: colors.semantic.info,
        variable: colors.text.primary,
        constant: colors.semantic.warning,
        operator: colors.text.secondary,
        comment: colors.text.muted,
        punctuation: colors.text.secondary,
      },
      language: {
        typescript: status(colors.accent[500], colors.accent[100], colors.accent[300]),
        javascript: status(colors.semantic.warning, colors.semantic.warningBg, colors.semantic.warningBorder),
        json: status(purple[500], purple[100], purple[300]),
        markdown: status(colors.text.secondary, colors.element.soft, colors.border.base),
        rust: status(colors.semantic.error, colors.semantic.errorBg, colors.semantic.errorBorder),
        css: status(colors.accent[600], colors.accent[100], colors.accent[300]),
        html: status(colors.accent[600], colors.accent[100], colors.accent[300]),
        shell: status(colors.semantic.success, colors.semantic.successBg, colors.semantic.successBorder),
        python: status(colors.semantic.info, colors.semantic.infoBg, colors.semantic.infoBorder),
      },
      toolFamily: {
        agent: status(purple[500], purple[100], purple[300]),
        code: status(colors.accent[500], colors.accent[100], colors.accent[300]),
        files: status(colors.semantic.info, colors.semantic.infoBg, colors.semantic.infoBorder),
        terminal: status(colors.semantic.success, colors.semantic.successBg, colors.semantic.successBorder),
        git: status(colors.git.branch, colors.git.branchBg, colors.border.medium),
        search: status(colors.semantic.warning, colors.semantic.warningBg, colors.semantic.warningBorder),
        browser: status(colors.accent[600], colors.accent[100], colors.accent[300]),
        design: status(purple[600], purple[100], purple[300]),
      },
      markdown: {
        link: colors.accent[500],
        inlineCode: status(colors.text.primary, colors.element.soft, colors.border.subtle),
        codeBlock: status(colors.text.primary, colors.background.tertiary, colors.border.base),
        blockquote: status(colors.text.secondary, colors.element.subtle, colors.border.medium),
        table: {
          headerBg: colors.element.soft,
          border: colors.border.base,
          rowHoverBg: colors.element.subtle,
        },
        hr: colors.border.base,
      },
      statusSurface: {
        neutral: neutralSurface,
        success: status(colors.semantic.success, colors.semantic.successBg, colors.semantic.successBorder),
        warning: status(colors.semantic.warning, colors.semantic.warningBg, colors.semantic.warningBorder),
        danger: status(colors.semantic.error, colors.semantic.errorBg, colors.semantic.errorBorder),
        info: status(colors.semantic.info, colors.semantic.infoBg, colors.semantic.infoBorder),
        running: runningSurface,
        pending: status(colors.text.muted, colors.element.subtle, colors.border.subtle),
      },
    },
    space: stringScale(effects.spacing),
    radius: {
      xs: effects.radius.sm,
      sm: effects.radius.sm,
      md: effects.radius.base,
      lg: effects.radius.lg,
      xl: effects.radius.xl,
      '2xl': effects.radius['2xl'] ?? effects.radius.xl,
      full: effects.radius.full,
    },
    typography: {
      family: typography.font,
      size: stringScale(typography.size),
      weight: numberRecord(typography.weight),
      lineHeight: numberRecord(typography.lineHeight),
    },
    shadow: stringScale(effects.shadow),
    motion: {
      duration: stringScale(motion.duration),
      easing: stringScale(motion.easing),
    },
    zIndex: {
      underlay: -1,
      base: 0,
      local: 1,
      raised: 2,
      header: 10,
      sticky: 20,
      floating: 50,
      dropdown: 80,
      scrim: 120,
      overlay: 160,
      drawer: 180,
      dialog: 240,
      fullscreen: 280,
      toast: 320,
      popover: 340,
      tooltip: 360,
      notification: 400,
      contextMenu: 500,
    },
  };
}
