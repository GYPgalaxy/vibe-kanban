import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDirectHostRequest,
  DirectHost,
  UpdateDirectHostRequest,
} from 'shared/types';
import { directHostsApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
} from './SettingsComponents';
import { REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY } from '@/shared/hooks/useRemoteCloudHosts';

interface DirectHostsSettingsSectionProps {
  initialState?: { hostId?: string };
}

type DirectHostDraft = {
  name: string;
  ssh_host: string;
  ssh_user: string;
  ssh_port: string;
  remote_api_host: string;
  remote_api_port: string;
};

const directHostsQueryKey = ['direct-hosts'] as const;

const emptyDraft: DirectHostDraft = {
  name: '',
  ssh_host: '',
  ssh_user: '',
  ssh_port: '22',
  remote_api_host: '127.0.0.1',
  remote_api_port: '3000',
};

function hostToDraft(host: DirectHost): DirectHostDraft {
  return {
    name: host.name,
    ssh_host: host.ssh_host,
    ssh_user: host.ssh_user ?? '',
    ssh_port: String(host.ssh_port),
    remote_api_host: host.remote_api_host,
    remote_api_port: String(host.remote_api_port),
  };
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildCreatePayload(draft: DirectHostDraft): CreateDirectHostRequest {
  return {
    name: draft.name,
    ssh_host: draft.ssh_host,
    ssh_user: draft.ssh_user || null,
    ssh_port: toNumber(draft.ssh_port, 22),
    remote_api_host: draft.remote_api_host || '127.0.0.1',
    remote_api_port: toNumber(draft.remote_api_port, 3000),
  };
}

function buildUpdatePayload(draft: DirectHostDraft): UpdateDirectHostRequest {
  return buildCreatePayload(draft);
}

export function DirectHostsSettingsSection({
  initialState,
}: DirectHostsSettingsSectionProps) {
  const queryClient = useQueryClient();
  const [selectedHostId, setSelectedHostId] = useState<string | null>(
    initialState?.hostId ?? null
  );
  const [draft, setDraft] = useState<DirectHostDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const directHostsQuery = useQuery({
    queryKey: directHostsQueryKey,
    queryFn: directHostsApi.list,
  });

  const hosts = directHostsQuery.data ?? [];
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId]
  );

  useEffect(() => {
    if (selectedHost) {
      setDraft(hostToDraft(selectedHost));
      return;
    }

    setDraft(emptyDraft);
  }, [selectedHost]);

  const invalidateHosts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: directHostsQueryKey }),
      queryClient.invalidateQueries({
        queryKey: REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY,
      }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim() || !draft.ssh_host.trim()) {
        throw new Error('Name and SSH host are required.');
      }

      if (selectedHostId) {
        return directHostsApi.update(selectedHostId, buildUpdatePayload(draft));
      }

      return directHostsApi.create(buildCreatePayload(draft));
    },
    onSuccess: async (host) => {
      setSelectedHostId(host.id);
      setError(null);
      await invalidateHosts();
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to save host.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (hostId: string) => {
      await directHostsApi.delete(hostId);
    },
    onSuccess: async () => {
      setSelectedHostId(null);
      setError(null);
      await invalidateHosts();
    },
    onError: (error) => {
      setError(
        error instanceof Error ? error.message : 'Failed to delete host.'
      );
    },
  });

  const updateDraft = (patch: Partial<DirectHostDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <>
      {error && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          {error}
        </div>
      )}

      <SettingsCard
        title="Direct Remote Hosts"
        description="Register servers that run Vibe Kanban and Claude Code. The local Kanban will connect through SSH and proxy host-scoped API calls to that server."
        headerAction={
          <PrimaryButton
            variant="tertiary"
            value="New Host"
            onClick={() => setSelectedHostId(null)}
          />
        }
      >
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div className="rounded-sm border border-border overflow-hidden bg-secondary/40">
            {directHostsQuery.isLoading ? (
              <div className="p-3 text-sm text-low">Loading hosts...</div>
            ) : hosts.length === 0 ? (
              <div className="p-3 text-sm text-low">No remote hosts.</div>
            ) : (
              hosts.map((host) => (
                <button
                  key={host.id}
                  type="button"
                  onClick={() => setSelectedHostId(host.id)}
                  className={cn(
                    'w-full px-3 py-2 text-left border-b border-border last:border-b-0',
                    selectedHostId === host.id
                      ? 'bg-brand/10 text-brand'
                      : 'text-normal hover:bg-secondary'
                  )}
                >
                  <div className="text-sm font-medium truncate">
                    {host.name}
                  </div>
                  <div className="text-xs text-low truncate">
                    {host.ssh_user ? `${host.ssh_user}@` : ''}
                    {host.ssh_host}:{host.remote_api_port}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-4">
            <SettingsField
              label="Name"
              description="Display name shown in the Kanban sidebar."
            >
              <SettingsInput
                value={draft.name}
                onChange={(name) => updateDraft({ name })}
                placeholder="Production GPU"
              />
            </SettingsField>

            <SettingsField
              label="SSH Host"
              description="Hostname or IP address reachable from this machine."
            >
              <SettingsInput
                value={draft.ssh_host}
                onChange={(ssh_host) => updateDraft({ ssh_host })}
                placeholder="203.0.113.10"
              />
            </SettingsField>

            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField
                label="SSH User"
                description="Leave empty to use your SSH config default."
              >
                <SettingsInput
                  value={draft.ssh_user}
                  onChange={(ssh_user) => updateDraft({ ssh_user })}
                  placeholder="ubuntu"
                />
              </SettingsField>

              <SettingsField label="SSH Port">
                <SettingsInput
                  value={draft.ssh_port}
                  onChange={(ssh_port) => updateDraft({ ssh_port })}
                  placeholder="22"
                />
              </SettingsField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField
                label="Remote API Host"
                description="Usually 127.0.0.1 from the remote server."
              >
                <SettingsInput
                  value={draft.remote_api_host}
                  onChange={(remote_api_host) =>
                    updateDraft({ remote_api_host })
                  }
                  placeholder="127.0.0.1"
                />
              </SettingsField>

              <SettingsField
                label="Remote API Port"
                description="The port where Vibe Kanban backend runs remotely."
              >
                <SettingsInput
                  value={draft.remote_api_port}
                  onChange={(remote_api_port) =>
                    updateDraft({ remote_api_port })
                  }
                  placeholder="3000"
                />
              </SettingsField>
            </div>

            <div className="flex justify-between pt-2">
              <PrimaryButton
                variant="tertiary"
                value="Delete"
                disabled={!selectedHostId || deleteMutation.isPending}
                onClick={() => {
                  if (selectedHostId) {
                    deleteMutation.mutate(selectedHostId);
                  }
                }}
              />
              <PrimaryButton
                value={selectedHostId ? 'Save Host' : 'Add Host'}
                actionIcon={saveMutation.isPending ? 'spinner' : undefined}
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              />
            </div>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
