'use client';

import ProjectForm from './ProjectForm';
import type { SerializedProject } from './types';

export default function ProjectEditModal({
  project,
  onClose,
}: {
  project: SerializedProject;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-nord-3 dark:bg-nord-1/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Редактировать проект
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              Изменение реквизитов и статуса проекта
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-nord-4 text-sm font-bold"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          <ProjectForm
            project={project}
            submitLabel="Сохранить"
            onSaved={onClose}
            footer={({ saving }) => (
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-nord-3">
                <button type="button" onClick={onClose} className="btn-secondary text-xs">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="btn-primary text-xs">
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
