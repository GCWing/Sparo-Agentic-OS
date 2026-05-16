/**
 * Large card layout
 */

import React, { useState } from 'react';
import type { PreviewExample } from '../../types';
import { PreviewUsageGuide } from '../PreviewUsageGuide';
import './LargeCardLayout.css';

interface LargeCardLayoutProps {
  examples: PreviewExample[];
}

export const LargeCardLayout: React.FC<LargeCardLayoutProps> = ({ examples }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <div className="large-card-layout">
      {examples.map((example) => {
        const Example = example.render;
        const isExpanded = expandedIds.has(example.id);
        return (
          <div key={example.id} className={`large-card ${isExpanded ? 'expanded' : ''}`}>
            <div className="large-card-header">
              <div className="large-card-info">
                <h3 className="large-card-title">{example.name}</h3>
                <p className="large-card-description">{example.description}</p>
              </div>
              <button 
                className="expand-button"
                onClick={() => toggleExpand(example.id)}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            
            <div className="large-card-preview">
              <Example />
            </div>
            <PreviewUsageGuide guide={example.ai} />
          </div>
        );
      })}
    </div>
  );
};
