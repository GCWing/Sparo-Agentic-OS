/**
 * Column layout
 */

import React from 'react';
import type { PreviewExample } from '../../types';
import './ColumnLayout.css';

interface ColumnLayoutProps {
  examples: PreviewExample[];
}

export const ColumnLayout: React.FC<ColumnLayoutProps> = ({ examples }) => {
  const scrollToExample = (id: string) => {
    const element = document.getElementById(`example-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="column-layout">
      <div className="column-nav">
        <div className="column-nav-title">Quick jump</div>
        <div className="column-nav-items">
          {examples.map((example) => (
            <button
              key={example.id}
              className="column-nav-item"
              onClick={() => scrollToExample(example.id)}
              title={example.description}
            >
              {example.name}
            </button>
          ))}
        </div>
      </div>

      <div className="column-content">
        {examples.map((example) => {
          const Example = example.render;

          return (
          <div
            key={example.id}
            id={`example-${example.id}`}
            className="column-item"
          >
            <div className="column-item-header">
              <h3 className="column-item-title">{example.name}</h3>
              <p className="column-item-description">{example.description}</p>
            </div>
            
            <div className="column-item-preview">
              <Example />
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};
