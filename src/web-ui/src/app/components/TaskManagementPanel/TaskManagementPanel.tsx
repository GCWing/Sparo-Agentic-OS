/**
 * Left-side floating task management drawer.
 *
 * Uses the design-system Dialog primitive for focus trapping, Escape handling,
 * and backdrop close behavior while preserving the drawer placement.
 */

import React, { lazy, Suspense } from 'react';
import { Dialog } from '@/design-system';
import { useSessionCapsuleStore } from '../../stores/sessionCapsuleStore';
import { ProcessingIndicator } from '@/flow_chat/components/modern/ProcessingIndicator';
import './TaskManagementPanel.scss';

const TaskDetailScene = lazy(() => import('../../scenes/task-detail/TaskDetailScene'));

const TaskManagementPanel: React.FC = () => {
  const open = useSessionCapsuleStore((s) => s.taskPanelOpen);
  const close = useSessionCapsuleStore((s) => s.closeTaskPanel);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      ariaLabel="Task management"
      placement="bottom-left"
      size="xlarge"
      showCloseButton={false}
      closeOnEscape
      closeOnOverlayClick
      overlayClassName="task-mgmt-panel-root"
      className="task-mgmt-panel"
      contentClassName="task-mgmt-panel__body"
    >
      <Suspense
        fallback={
          <div className="task-mgmt-panel__loading">
            <ProcessingIndicator visible />
          </div>
        }
      >
        <TaskDetailScene />
      </Suspense>
    </Dialog>
  );
};

export default TaskManagementPanel;
