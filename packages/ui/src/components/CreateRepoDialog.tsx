import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './KeyboardDialog';
import { Button } from './Button';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { FolderSimpleIcon, SpinnerIcon } from '@phosphor-icons/react';
import { defineModal } from '../lib/modals';

/** Resolved information about the currently-entered location path. */
export interface ResolvedLocationInfo {
  exists: boolean;
  isGitRepo: boolean;
}

export interface CreateRepoDialogProps {
  onBrowseForPath?: (currentPath: string) => Promise<string | null | undefined>;
  onCreateRepo: (params: {
    parentPath: string;
    folderName: string;
  }) => Promise<void>;
  /**
   * Inspect the entered location path (existence / git status). When omitted the
   * dialog always stays in "create" mode. Used to detect an existing repository
   * at the location so it can be opened/reused instead of creating a child.
   */
  resolveLocationInfo?: (path: string) => Promise<ResolvedLocationInfo | null>;
  /**
   * Called when the location is an existing git repository and the user chooses
   * to open it. Implementations should register/reuse the repo at `path`.
   */
  onOpenExistingRepo?: (path: string) => Promise<void>;
}

export type CreateRepoDialogResult = {
  action: 'created' | 'opened' | 'canceled';
};

const CreateRepoDialogImpl = NiceModal.create<CreateRepoDialogProps>(
  ({
    onBrowseForPath,
    onCreateRepo,
    resolveLocationInfo,
    onOpenExistingRepo,
  }) => {
    const { t } = useTranslation(['tasks', 'common']);
    const modal = useModal();

    const [name, setName] = useState('');
    const [parentPath, setParentPath] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [locationInfo, setLocationInfo] =
      useState<ResolvedLocationInfo | null>(null);

    // When the location points at an existing git repository, switch into
    // "open existing repository" mode and reuse it instead of creating a child.
    const isOpenMode = !!locationInfo?.isGitRepo && !!onOpenExistingRepo;

    // Resolve the entered location (debounced implicitly by user input cadence).
    useEffect(() => {
      if (!resolveLocationInfo) return;
      const trimmed = parentPath.trim();
      let cancelled = false;
      if (!trimmed) {
        setLocationInfo(null);
        return;
      }
      resolveLocationInfo(trimmed)
        .then((info) => {
          if (!cancelled) setLocationInfo(info);
        })
        .catch(() => {
          // Path missing / not a directory / network error → create mode.
          if (!cancelled) setLocationInfo({ exists: false, isGitRepo: false });
        });
      return () => {
        cancelled = true;
      };
    }, [parentPath, resolveLocationInfo]);

    const handleBrowseForPath = useCallback(async () => {
      if (!onBrowseForPath) return;
      const selectedPath = await onBrowseForPath(parentPath);

      if (selectedPath) {
        setParentPath(selectedPath);
      }
    }, [onBrowseForPath, parentPath]);

    const handleCreate = useCallback(async () => {
      const trimmedLocation = parentPath.trim();
      const trimmedName = name.trim();

      setIsSubmitting(true);
      setError(null);
      try {
        if (isOpenMode) {
          if (!trimmedLocation) {
            setError(t('git.createRepo.errors.nameRequired'));
            return;
          }
          await onOpenExistingRepo!(trimmedLocation);
          modal.resolve({ action: 'opened' } as CreateRepoDialogResult);
          modal.hide();
          return;
        }

        if (!trimmedName) {
          setError(t('git.createRepo.errors.nameRequired'));
          return;
        }

        await onCreateRepo({
          parentPath: trimmedLocation || '.',
          folderName: trimmedName,
        });
        modal.resolve({ action: 'created' } as CreateRepoDialogResult);
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('git.createRepo.errors.createFailed')
        );
      } finally {
        setIsSubmitting(false);
      }
    }, [
      name,
      onCreateRepo,
      onOpenExistingRepo,
      parentPath,
      isOpenMode,
      modal,
      t,
    ]);

    const handleCancel = useCallback(() => {
      modal.resolve({ action: 'canceled' } as CreateRepoDialogResult);
      modal.hide();
    }, [modal]);

    const canSubmit = isOpenMode
      ? parentPath.trim().length > 0
      : name.trim().length > 0;

    return (
      <Dialog open={modal.visible} onOpenChange={handleCancel}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {isOpenMode
                ? t('git.createRepo.openDialog.title')
                : t('git.createRepo.dialog.title')}
            </DialogTitle>
            <DialogDescription>
              {isOpenMode
                ? t('git.createRepo.openDialog.description')
                : t('git.createRepo.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {/* Name input — hidden when opening an existing repository */}
            {!isOpenMode && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  {t('git.createRepo.form.nameLabel')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('git.createRepo.form.namePlaceholder')}
                  disabled={isSubmitting}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            )}

            {/* Location input */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                {t('git.createRepo.form.locationLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={parentPath}
                  onChange={(e) => setParentPath(e.target.value)}
                  placeholder={t('git.createRepo.form.locationPlaceholder')}
                  disabled={isSubmitting}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleBrowseForPath}
                  disabled={isSubmitting || !onBrowseForPath}
                >
                  <FolderSimpleIcon className="h-4 w-4" weight="fill" />
                </Button>
              </div>
              {isOpenMode && (
                <p className="text-sm text-muted-foreground">
                  {t('git.createRepo.openDialog.note')}
                </p>
              )}
            </div>

            {/* Error */}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin mr-2" />
                  {isOpenMode
                    ? t('git.createRepo.states.opening')
                    : t('git.createRepo.states.creating')}
                </>
              ) : isOpenMode ? (
                t('git.createRepo.buttons.openRepository')
              ) : (
                t('git.createRepo.buttons.createRepository')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateRepoDialog = defineModal<
  CreateRepoDialogProps,
  CreateRepoDialogResult
>(CreateRepoDialogImpl);
