import { useUI } from '@/store/ui';
import { closeProject, newProject, openProject, saveProject } from '../projectIO';

/** Ask for the new project's format (or go home when the editor is not open). */
export function newProjectPrompt(): void {
  useUI.getState().openModal('newProject');
}

export { closeProject, newProject, openProject, saveProject };
