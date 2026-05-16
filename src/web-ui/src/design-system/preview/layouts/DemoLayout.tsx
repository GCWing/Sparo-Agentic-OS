/**
 * Demo layout
 */

import React from 'react';
import type { PreviewExample } from '../../types';
import './DemoLayout.css';

interface DemoLayoutProps {
  examples: PreviewExample[];
}

export const DemoLayout: React.FC<DemoLayoutProps> = ({ examples }) => {
  return (
    <div className="demo-layout">
      {examples.map((example) => {
        const Example = example.render;

        return (
        <div key={example.id} className="demo-card">
          <div className="demo-card-header">
            <h3 className="demo-card-title">{example.name}</h3>
            <p className="demo-card-description">{example.description}</p>
          </div>
          
          <div className="demo-stage">
            <Example />
          </div>
          
          <div className="demo-card-footer">
            <span className="demo-id">ID: {example.id}</span>
          </div>
        </div>
        );
      })}
    </div>
  );
};
