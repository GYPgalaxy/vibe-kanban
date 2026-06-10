import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectsGuideDialog } from '@vibe/ui/components/ProjectsGuideDialog';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import {
  ProjectKanbanLayout,
  ProjectMutationsRegistration,
} from '@/pages/kanban/ProjectKanban';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useOrgContext } from '@/shared/hooks/useOrgContext';
import { LocalOrgProvider } from '@/shared/providers/local/LocalOrgProvider';
import { LocalProjectProvider } from '@/shared/providers/local/LocalProjectProvider';

const PROJECTS_GUIDE_ID = 'projects-guide';

function LocalProjectKanbanInner() {
  const { t } = useTranslation('common');
  const { projectId } = useCurrentKanbanRouteState();
  const { projects, isLoading } = useOrgContext();
  const project = projects.find((p) => p.id === projectId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <p className="text-low">{t('states.loading')}</p>
      </div>
    );
  }

  if (!projectId || !project) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <p className="text-low">{t('kanban.noProjectFound')}</p>
      </div>
    );
  }

  return (
    <LocalProjectProvider projectId={projectId}>
      <ProjectMutationsRegistration>
        <ProjectKanbanLayout projectName={project.name} />
      </ProjectMutationsRegistration>
    </LocalProjectProvider>
  );
}

export function LocalProjectKanban() {
  const { config, updateAndSaveConfig, loading } = useUserSystem();
  const { isLoaded, isSignedIn } = useAuth();
  const hasAutoShownProjectsGuide = useRef(false);

  useEffect(() => {
    if (hasAutoShownProjectsGuide.current) return;
    if (!isLoaded || !isSignedIn || loading || !config) return;

    const seenFeatures = config.showcases?.seen_features ?? [];
    if (seenFeatures.includes(PROJECTS_GUIDE_ID)) return;

    hasAutoShownProjectsGuide.current = true;

    void updateAndSaveConfig({
      showcases: { seen_features: [...seenFeatures, PROJECTS_GUIDE_ID] },
    });
    ProjectsGuideDialog.show().finally(() => ProjectsGuideDialog.hide());
  }, [config, isLoaded, isSignedIn, loading, updateAndSaveConfig]);

  return (
    <LocalOrgProvider>
      <LocalProjectKanbanInner />
    </LocalOrgProvider>
  );
}
