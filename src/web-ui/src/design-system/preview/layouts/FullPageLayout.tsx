/**
 * Full-page layout
 */

import React, { useState } from 'react';
import type { PreviewExample } from '../../types';
import './FullPageLayout.css';

interface FullPageLayoutProps {
  examples: PreviewExample[];
}

export const FullPageLayout: React.FC<FullPageLayoutProps> = ({ examples }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  if (examples.length === 1) {
    const Example = examples[0].render;
    return (
      <div className="full-page-layout">
        <div className="full-page-item">
          <Example />
        </div>
      </div>
    );
  }

  const ActiveExample = examples[activeIndex].render;

  return (
    <div className="full-page-layout">
      <div className="full-page-tabs">
        {examples.map((example, index) => (
          <button
            key={example.id}
            className={`full-page-tab ${index === activeIndex ? 'active' : ''}`}
            onClick={() => setActiveIndex(index)}
          >
            <span className="tab-name">{example.name}</span>
            <span className="tab-description">{example.description}</span>
          </button>
        ))}
      </div>

      <div className="full-page-content">
        <ActiveExample />
      </div>
    </div>
  );
};
