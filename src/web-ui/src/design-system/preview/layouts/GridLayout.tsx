/**
 * Grid layout
 */

import React from 'react';
import type { PreviewExample } from '../../types';
import type { LayoutType } from '../../types';
import { PreviewUsageGuide } from '../PreviewUsageGuide';
import './GridLayout.css';

interface GridLayoutProps {
  examples: PreviewExample[];
  columns?: 2 | 3 | 4;
  layoutType?: LayoutType;
}

export const GridLayout: React.FC<GridLayoutProps> = ({ 
  examples, 
  columns = 3
}) => {
  const gridClass = `grid-layout grid-cols-${columns}`;
  
  return (
    <div className={gridClass}>
      {examples.map((example) => {
        const Example = example.render;

        return (
        <div key={example.id} className="grid-card">
          <div className="grid-card-header">
            <h3 className="grid-card-title">{example.name}</h3>
            <p className="grid-card-description">{example.description}</p>
          </div>
          
          <div className="grid-card-preview">
            <div className="preview-label">Preview</div>
            <div className="preview-canvas">
              <Example />
            </div>
          </div>
          
          <div className="grid-card-info">
            <PreviewUsageGuide guide={example.ai} />
            <dl className="info-list">
              <dt>ID</dt>
              <dd>{example.id}</dd>
            </dl>
          </div>
        </div>
        );
      })}
    </div>
  );
};
