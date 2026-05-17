import React, { useState, createContext, useContext, useMemo, useId } from 'react';
import './Tabs.scss';

export interface TabItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  closable?: boolean;
}

export interface TabsProps {
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  onTabClose?: (key: string) => void;
  type?: 'line' | 'card' | 'pill';
  size?: 'small' | 'medium' | 'large';
  stretch?: boolean;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface TabPaneProps {
  tabKey: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  closable?: boolean;
  children?: React.ReactNode;
  className?: string;
}

interface TabsContextValue {
  getTabId: (key: string) => string;
  getPanelId: (key: string) => string;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

export const TabPane: React.FC<TabPaneProps> = ({ tabKey, children, className = '' }) => {
  const context = useContext(TabsContext);
  if (!context) return null;

  return (
    <div
      id={context.getPanelId(tabKey)}
      className={`ds-tab-pane ${className}`.trim()}
      role="tabpanel"
      aria-labelledby={context.getTabId(tabKey)}
      tabIndex={0}
    >
      {children}
    </div>
  );
};

TabPane.displayName = 'TabPane';

export const Tabs: React.FC<TabsProps> = ({
  activeKey: controlledActiveKey,
  defaultActiveKey,
  onChange,
  onTabClose,
  type = 'line',
  size = 'medium',
  stretch = false,
  children,
  className = '',
  style,
}) => {
  const generatedId = useId();
  const [internalActiveKey, setInternalActiveKey] = useState<string>(defaultActiveKey || '');

  const { tabs, panes } = useMemo(() => {
    const nextTabs: TabItem[] = [];
    const nextPanes: { [key: string]: React.ReactNode } = {};

    React.Children.forEach(children, (child) => {
      if (React.isValidElement<TabPaneProps>(child) && child.type === TabPane) {
        const { tabKey, label, icon, disabled, closable } = child.props;
        nextTabs.push({ key: tabKey, label, icon, disabled, closable });
        nextPanes[tabKey] = child;
      }
    });

    return { tabs: nextTabs, panes: nextPanes };
  }, [children]);

  const firstEnabledKey = tabs.find((tab) => !tab.disabled)?.key ?? tabs[0]?.key ?? '';
  const activeKey = controlledActiveKey !== undefined
    ? controlledActiveKey
    : internalActiveKey || firstEnabledKey;

  React.useEffect(() => {
    if (!internalActiveKey && firstEnabledKey && controlledActiveKey === undefined) {
      setInternalActiveKey(firstEnabledKey);
    }
  }, [controlledActiveKey, firstEnabledKey, internalActiveKey]);

  const getTabId = (key: string) => `${generatedId}-tab-${key}`;
  const getPanelId = (key: string) => `${generatedId}-panel-${key}`;

  const handleTabClick = (key: string, disabled?: boolean) => {
    if (disabled) return;

    if (controlledActiveKey === undefined) {
      setInternalActiveKey(key);
    }
    onChange?.(key);
  };

  const handleTabClose = (event: React.MouseEvent, key: string) => {
    event.stopPropagation();
    onTabClose?.(key);
  };

  const focusTab = (key: string) => {
    document.getElementById(getTabId(key))?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent, currentIndex: number) => {
    const enabledTabs = tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => !tab.disabled);
    const enabledIndex = enabledTabs.findIndex(({ index }) => index === currentIndex);
    if (enabledIndex === -1) return;

    let next: { tab: TabItem; index: number } | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = enabledTabs[(enabledIndex + 1) % enabledTabs.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = enabledTabs[(enabledIndex - 1 + enabledTabs.length) % enabledTabs.length];
    } else if (event.key === 'Home') {
      next = enabledTabs[0];
    } else if (event.key === 'End') {
      next = enabledTabs[enabledTabs.length - 1];
    }

    if (!next) return;
    event.preventDefault();
    handleTabClick(next.tab.key, next.tab.disabled);
    focusTab(next.tab.key);
  };

  const containerClass = [
    'ds-tabs',
    `ds-tabs--${type}`,
    `ds-tabs--${size}`,
    stretch && 'ds-tabs--stretch',
    className,
  ].filter(Boolean).join(' ');

  const contextValue: TabsContextValue = { getTabId, getPanelId };

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={containerClass} style={style}>
        <div className="ds-tabs__nav">
          <div className="ds-tabs__nav-list" role="tablist">
            {tabs.map((tab, index) => (
              <button
                key={tab.key}
                id={getTabId(tab.key)}
                className={[
                  'ds-tabs__tab',
                  activeKey === tab.key && 'ds-tabs__tab--active',
                  tab.disabled && 'ds-tabs__tab--disabled',
                ].filter(Boolean).join(' ')}
                type="button"
                role="tab"
                aria-selected={activeKey === tab.key}
                aria-controls={getPanelId(tab.key)}
                tabIndex={activeKey === tab.key ? 0 : -1}
                disabled={tab.disabled}
                onClick={() => handleTabClick(tab.key, tab.disabled)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.icon && <span className="ds-tabs__tab-icon">{tab.icon}</span>}
                <span className="ds-tabs__tab-label">{tab.label}</span>
                {tab.closable && (
                  <span
                    className="ds-tabs__tab-close"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Close ${String(tab.label)}`}
                    onClick={(event) => handleTabClose(event, tab.key)}
                  >
                    x
                  </span>
                )}
              </button>
            ))}
          </div>
          {type === 'line' && <div className="ds-tabs__ink-bar" />}
        </div>
        <div className="ds-tabs__content">{panes[activeKey]}</div>
      </div>
    </TabsContext.Provider>
  );
};

Tabs.displayName = 'Tabs';
