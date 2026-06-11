import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppBarHost, AppBarHostStatus } from '@vibe/ui/components/AppBar';
import type {
  DirectHost,
  PairRelayHostRequest,
  RelayPairedHost,
} from 'shared/types';
import type { RelayHost } from 'shared/remote-types';
import { directHostsApi, relayApi } from '@/shared/lib/api';
import { listRelayHosts } from '@/shared/lib/remoteApi';
import {
  useAppRuntime,
  useCloudFeaturesEnabled,
} from '@/shared/hooks/useAppRuntime';

export type RemoteCloudHostStatus = AppBarHostStatus;

export interface RemoteCloudHost {
  id: string;
  name: string;
  status: RemoteCloudHostStatus;
  pairedAt: string;
  lastUsedAt: string;
}

interface RemoteCloudHostsState {
  hosts: RemoteCloudHost[];
}

export const REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY = [
  'remote-cloud-hosts',
  'state',
] as const;

function normalizeRemoteCloudHostStatus(
  status: RelayHost['status'] | undefined
): RemoteCloudHostStatus {
  if (status === 'online' || status === 'offline' || status === 'unpaired') {
    return status;
  }

  return 'offline';
}

async function fetchRemoteCloudHostsState(): Promise<RemoteCloudHostsState> {
  let pairedHosts: RelayPairedHost[] = [];
  try {
    pairedHosts = await relayApi.listPairedRelayHosts();
  } catch {
    return { hosts: [] };
  }

  let remoteHosts: RelayHost[] = [];
  try {
    remoteHosts = await listRelayHosts();
  } catch {
    remoteHosts = [];
  }

  const remoteHostsById = new Map(remoteHosts.map((host) => [host.id, host]));

  const hosts = pairedHosts
    .map((host) => {
      const remoteHost = remoteHostsById.get(host.host_id);
      const status = normalizeRemoteCloudHostStatus(remoteHost?.status);
      const pairedAt = host.paired_at ?? '';

      return {
        id: host.host_id,
        name: remoteHost?.name ?? host.host_name ?? host.host_id,
        status,
        pairedAt,
        lastUsedAt: pairedAt,
      };
    })
    .sort((a, b) => b.pairedAt.localeCompare(a.pairedAt));

  return { hosts };
}

function mapDirectHostStatus(host: DirectHost): RemoteCloudHostStatus {
  return host.status === 'online' ? 'online' : 'offline';
}

async function fetchLocalDirectHostsState(): Promise<RemoteCloudHostsState> {
  const directHosts = await directHostsApi.list();

  const hosts = directHosts.map((host) => ({
    id: host.id,
    name: host.name,
    status: mapDirectHostStatus(host),
    pairedAt: host.created_at,
    lastUsedAt: host.updated_at,
  }));

  return { hosts };
}

export function useRemoteCloudHostsState() {
  const runtime = useAppRuntime();
  const cloudFeaturesEnabled = useCloudFeaturesEnabled();
  const useDirectHosts = runtime === 'local' && !cloudFeaturesEnabled;

  return useQuery({
    queryKey: [...REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY, runtime, useDirectHosts],
    queryFn: useDirectHosts
      ? fetchLocalDirectHostsState
      : fetchRemoteCloudHostsState,
    enabled: useDirectHosts || cloudFeaturesEnabled,
    staleTime: 0,
  });
}

export function usePairRemoteCloudHostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PairRelayHostRequest) =>
      relayApi.pairRelayHost(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY,
      });
    },
  });
}

export function useRemoveRemoteCloudHostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostId: string) => relayApi.removePairedRelayHost(hostId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: REMOTE_CLOUD_HOSTS_STATE_QUERY_KEY,
      });
    },
  });
}

export function useRemoteCloudHostsAppBarModel(): {
  hosts: AppBarHost[];
  remoteHosts: RemoteCloudHost[];
} {
  const { data } = useRemoteCloudHostsState();

  const remoteHosts = data?.hosts ?? [];

  const hosts = useMemo<AppBarHost[]>(
    () =>
      remoteHosts.map((host) => ({
        id: host.id,
        name: host.name,
        status: host.status,
      })),
    [remoteHosts]
  );

  return {
    hosts,
    remoteHosts,
  };
}
