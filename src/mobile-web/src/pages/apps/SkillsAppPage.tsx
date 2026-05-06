import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { RemoteSessionManager, type SkillInfo } from '../../services/RemoteSessionManager';
import { useMobileStore } from '../../services/store';
import EyebrowLabel from '../../components/EyebrowLabel';
import HairlineDivider from '../../components/HairlineDivider';
import './AppPage.scss';
import './SkillsAppPage.scss';

interface SkillsAppPageProps {
  sessionMgr: RemoteSessionManager;
}

const SkillsAppPage: React.FC<SkillsAppPageProps> = ({ sessionMgr }) => {
  const { t, language } = useI18n();
  const { selectedWorkspace } = useMobileStore();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await sessionMgr.listSkills(selectedWorkspace?.path);
        setSkills(result);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load skills');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [sessionMgr, selectedWorkspace?.path]);

  const userSkills = skills.filter((s) => s.level === 'user');
  const projectSkills = skills.filter((s) => s.level === 'project');
  const builtinSkills = skills.filter((s) => s.isBuiltin);

  const renderSkillRow = (skill: SkillInfo, idx: number) => (
    <React.Fragment key={skill.key}>
      <div className="skills-row">
        <span className="skills-row__num">{String(idx + 1).padStart(2, '0')}</span>
        <div className="skills-row__body">
          <span className="skills-row__name">{skill.name}</span>
          {skill.description && (
            <span className="skills-row__desc">{skill.description}</span>
          )}
        </div>
        {skill.isBuiltin && (
          <span className="skills-row__badge">
            {language === 'zh-CN' ? '内置' : 'Built-in'}
          </span>
        )}
      </div>
      <HairlineDivider />
    </React.Fragment>
  );

  if (loading) {
    return (
      <div className="app-page">
        <div className="app-page__loading">{t('common.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-page">
        <div className="app-page__section-head">
          <EyebrowLabel>{t('apps.skills')}</EyebrowLabel>
        </div>
        <HairlineDivider />
        <div className="app-page__placeholder">
          <div className="app-page__placeholder-dot" aria-hidden="true" />
          <strong className="app-page__placeholder-title">
            {language === 'zh-CN' ? '加载失败' : 'Failed to load'}
          </strong>
          <p className="app-page__placeholder-desc">{error}</p>
        </div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="app-page">
        <div className="app-page__section-head">
          <EyebrowLabel>{t('apps.skills')}</EyebrowLabel>
        </div>
        <HairlineDivider />
        <div className="app-page__placeholder">
          <div className="app-page__placeholder-dot" aria-hidden="true" />
          <strong className="app-page__placeholder-title">
            {language === 'zh-CN' ? '暂无技能' : 'No skills found'}
          </strong>
          <p className="app-page__placeholder-desc">
            {language === 'zh-CN'
              ? '在工作区的 .cursor/skills/ 目录或用户级 skills 目录下添加技能文件'
              : 'Add skill files under .cursor/skills/ in your workspace or user-level skills directory'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      {projectSkills.length > 0 && (
        <>
          <div className="app-page__section-head">
            <EyebrowLabel>{language === 'zh-CN' ? '项目技能' : 'Project Skills'}</EyebrowLabel>
          </div>
          <HairlineDivider />
          {projectSkills.map((s, i) => renderSkillRow(s, i))}
        </>
      )}

      {userSkills.filter((s) => !s.isBuiltin).length > 0 && (
        <>
          <div className={`app-page__section-head${projectSkills.length > 0 ? ' app-page__section-head--mt' : ''}`}>
            <EyebrowLabel>{language === 'zh-CN' ? '用户技能' : 'User Skills'}</EyebrowLabel>
          </div>
          <HairlineDivider />
          {userSkills.filter((s) => !s.isBuiltin).map((s, i) => renderSkillRow(s, projectSkills.length + i))}
        </>
      )}

      {builtinSkills.length > 0 && (
        <>
          <div className="app-page__section-head app-page__section-head--mt">
            <EyebrowLabel>{language === 'zh-CN' ? '内置技能' : 'Built-in Skills'}</EyebrowLabel>
          </div>
          <HairlineDivider />
          {builtinSkills.map((s, i) => renderSkillRow(s, userSkills.filter((x) => !x.isBuiltin).length + projectSkills.length + i))}
        </>
      )}
    </div>
  );
};

export default SkillsAppPage;
