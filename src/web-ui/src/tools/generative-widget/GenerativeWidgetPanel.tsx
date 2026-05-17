import React from 'react';
import GenerativeWidgetFrame from './GenerativeWidgetFrame';
import { handleWidgetBridgeEvent } from './widgetInteraction';
import './GenerativeWidgetPanel.scss';

export interface GenerativeWidgetPanelProps {
  title?: string;
  widgetId?: string;
  widgetCode?: string;
}

export const GenerativeWidgetPanel: React.FC<GenerativeWidgetPanelProps> = ({
  title,
  widgetId,
  widgetCode,
}) => {
  const handleWidgetEvent = React.useCallback((event: any) => {
    handleWidgetBridgeEvent(event, 'panel');
  }, []);

  if (!widgetCode) {
    return (
      <div className="sparo-generative-widget-panel sparo-generative-widget-panel--empty">
        <div className="sparo-generative-widget-panel__empty-copy">
          No widget content available.
        </div>
      </div>
    );
  }

  return (
    <div className="sparo-generative-widget-panel">
      <GenerativeWidgetFrame
        widgetId={widgetId || `panel-widget-${Date.now()}`}
        title={title}
        widgetCode={widgetCode}
        executeScripts={true}
        onWidgetEvent={handleWidgetEvent}
      />
    </div>
  );
};

export default GenerativeWidgetPanel;
