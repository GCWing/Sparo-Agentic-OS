 

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigPageHeader } from './ConfigPageHeader';
import { ConfigPageLayout, ConfigPageContent } from './ConfigPageLayout';
import { Button } from '@/design-system';

 
export const BasicHeaderExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ConfigPageLayout>
      <ConfigPageHeader
        title={t('configPageHeaderExample.basic.title')}
      />
      <ConfigPageContent>
        
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

 
export const HeaderWithIconExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ConfigPageLayout>
      <ConfigPageHeader
        title={t('configPageHeaderExample.apiNetwork.title')}
      />
      <ConfigPageContent>
        
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

 
export const HeaderWithActionsExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ConfigPageLayout>
      <ConfigPageHeader
        title={t('configPageHeaderExample.learning.title')}
        extra={
          <>
            <Button variant="secondary" size="sm">
              {t('configPageHeaderExample.learning.import')}
            </Button>
            <Button variant="primary" size="sm">
              {t('configPageHeaderExample.learning.addMemory')}
            </Button>
          </>
        }
      />
      <ConfigPageContent>
        
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

 
export const CompleteConfigPageExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ConfigPageLayout className="my-custom-config-page">
      
      <ConfigPageHeader
        title={t('configPageHeaderExample.agents.title')}
        extra={
          <Button variant="primary" size="sm">
            {t('configPageHeaderExample.agents.create')}
          </Button>
        }
      />
      
      
      <ConfigPageContent>
        
        <div className="config-toolbar">
          
        </div>
        
        
        <div className="config-items">
          
        </div>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

 
export const ThemeConfigExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ConfigPageLayout>
      <ConfigPageHeader
        title={t('configPageHeaderExample.theme.title')}
        extra={
          <>
            <Button variant="secondary" size="sm">
              {t('configPageHeaderExample.theme.import')}
            </Button>
            <Button variant="secondary" size="sm">
              {t('configPageHeaderExample.theme.export')}
            </Button>
          </>
        }
      />
      <ConfigPageContent>
        
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};



