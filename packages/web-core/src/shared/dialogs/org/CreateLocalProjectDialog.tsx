import { useEffect, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import type { Project } from 'shared/types';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { localProjectsApi } from '@/shared/lib/api';
import { defineModal } from '@/shared/lib/modals';
import { createLocalId } from '@/shared/providers/local/localKanbanAdapters';

export type CreateLocalProjectResult = {
  action: 'created' | 'canceled';
  project?: Project;
};

type CreateLocalProjectDialogProps = {};

const CreateLocalProjectDialogImpl = create<CreateLocalProjectDialogProps>(
  () => {
    const modal = useModal();
    const { t } = useTranslation('projects');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
      if (!modal.visible) return;

      setName('');
      setError(null);
      setIsCreating(false);
    }, [modal.visible]);

    const validateName = (value: string): string | null => {
      const trimmedValue = value.trim();
      if (!trimmedValue) return 'Project name is required';
      if (trimmedValue.length < 2) {
        return 'Project name must be at least 2 characters';
      }
      if (trimmedValue.length > 100) {
        return 'Project name must be 100 characters or less';
      }
      return null;
    };

    const handleCreate = async () => {
      const nameError = validateName(name);
      if (nameError) {
        setError(nameError);
        return;
      }

      setError(null);
      setIsCreating(true);

      try {
        const project = await localProjectsApi.create({
          id: createLocalId(),
          name: name.trim(),
        });
        modal.resolve({
          action: 'created',
          project,
        } satisfies CreateLocalProjectResult);
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create project'
        );
        setIsCreating(false);
      }
    };

    const handleCancel = () => {
      modal.resolve({ action: 'canceled' } satisfies CreateLocalProjectResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (isCreating) return;
      if (!open) handleCancel();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && name.trim() && !isCreating) {
        e.preventDefault();
        void handleCreate();
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('createProjectDialog.title', 'Create Project')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'createProjectDialog.localDescription',
                'Create a local kanban project on this machine.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="local-project-name">
                {t('createProjectDialog.nameLabel', 'Project name')}
              </Label>
              <Input
                id="local-project-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t(
                  'createProjectDialog.namePlaceholder',
                  'Enter project name'
                )}
                maxLength={100}
                autoFocus
                disabled={isCreating}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || isCreating}
            >
              {isCreating
                ? t('createProjectDialog.creating', 'Creating...')
                : t('createProjectDialog.createButton', 'Create Project')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateLocalProjectDialog = defineModal<
  CreateLocalProjectDialogProps,
  CreateLocalProjectResult
>(CreateLocalProjectDialogImpl);
