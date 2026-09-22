'use client';

import ProjectForm from './ProjectForm';
import type { SerializedProject } from './types';

export default function ProjectSettingsPanel({ project }: { project: SerializedProject }) {
  return (
    <div className="card p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
          Параметры и реквизиты проекта
        </h2>
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          Управление метаданными проекта, шифром и статусом согласования.
        </p>
      </div>

      <ProjectForm project={project} submitLabel="Сохранить изменения" />
    </div>
  );
}
