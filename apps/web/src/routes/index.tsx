import {
  type Account,
  type AccountDeletionResult,
  createOpenMemoryClient,
  type GraphEdge,
  type GraphExportResult,
  type GraphImportPreviewResult,
  type GraphImportResult,
  type GraphStats,
  type IndexRepairResult,
  type Memory,
  type OAuthConnection,
  OpenMemoryApiError,
  type ReadinessSnapshot,
  type SourceIngestResult,
} from "@openmemory/client";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@openmemory/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import type { Updater } from "@tanstack/react-table";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  Network,
  Plug,
  RefreshCw,
  Send,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import {
  type FormEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AccountStatus,
  AdminWorkspace,
  type AuthUser,
} from "../admin-components";
import {
  DEFAULT_API_URL,
  getProductionDefaultApiUrl,
  isLocalApiUrl,
} from "../connection-defaults";
import {
  KnowledgeMap,
  MemoryDataTable,
  type MemoryTableSorting,
} from "../dashboard-components";
import {
  type DashboardMetrics,
  getDashboardMetrics,
  getGraphImportPreviewSummary,
  getGraphOperationsSummary,
  getLifecycleDistribution,
  getMemoryNeighborDetails,
  getReadinessSummary,
  getRecentActivity,
  getSourceIngestSummary,
  getTypeDistribution,
} from "../dashboard-model";
import { Route as rootRoute } from "./__root";

const INITIAL_ACTIVITY_NOW = new Date("2026-01-07T00:00:00.000Z");

const DashboardOverview = lazy(() =>
  import("../dashboard-overview").then((module) => ({
    default: module.DashboardOverview,
  })),
);
const OVERVIEW_SKELETON_TILES = [
  "active",
  "edges",
  "entities",
  "clients",
  "activity",
  "graph",
  "types",
  "relationships",
  "lifecycle",
  "index",
];

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => ({
    graphRelationship: parseRelationshipParam(search.graphRelationship),
    graphSearch: parseSearchTextParam(search.graphSearch),
    graphType: parseMemoryTypeParam(search.graphType),
    memoryId: parseMemoryId(search.memoryId),
    memorySearch: parseSearchTextParam(search.memorySearch),
    memorySort: parseMemorySortParam(search.memorySort),
    memoryType: parseMemoryTypeParam(search.memoryType),
    recallQuery: parseSearchTextParam(search.recallQuery),
    view: parseView(search.view),
  }),
  component: Home,
});

const VIEW_LABELS = {
  recall: "Recall",
  ingest: "Ingest",
  graph: "Knowledge Map",
  mcp: "MCP",
  operations: "Operations",
  admin: "Admin",
} as const;

type View = keyof typeof VIEW_LABELS;
type DashboardSearch = ReturnType<typeof Route.useSearch>;

const DEFAULT_MEMORY_SORT: MemoryTableSorting = [
  { id: "updatedAt", desc: true },
];
const MEMORY_SORT_COLUMNS = new Set([
  "content",
  "signals",
  "status",
  "type",
  "updatedAt",
]);
const DEFAULT_DASHBOARD_SEARCH = {
  graphRelationship: undefined,
  graphSearch: undefined,
  graphType: undefined,
  memoryId: undefined,
  memorySearch: undefined,
  memorySort: undefined,
  memoryType: undefined,
  recallQuery: undefined,
  view: "recall",
} satisfies DashboardSearch;

function Home() {
  const routeSearch = Route.useSearch();
  const hasMounted = useHasMounted();
  const {
    graphRelationship,
    graphSearch,
    graphType,
    memoryId,
    memorySearch,
    memorySort,
    memoryType,
    recallQuery,
    view: searchView,
  } = hasMounted ? routeSearch : DEFAULT_DASHBOARD_SEARCH;
  const view = parseView(searchView);
  const navigate = Route.useNavigate();
  const [apiUrl, setApiUrl, hasLoadedApiUrl] = useLocalStorage(
    "openmemory:apiUrl",
    DEFAULT_API_URL,
  );
  const [tenantId, setTenantId, hasLoadedTenantId] = useLocalStorage(
    "openmemory:tenantId",
    "local-user",
  );
  const [token, setToken, hasLoadedToken] = useLocalStorage(
    "openmemory:token",
    "",
  );
  const [email, setEmail] = useLocalStorage("openmemory:email", "");
  const [name, setName] = useLocalStorage("openmemory:name", "");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");
  const [ingestContent, setIngestContent] = useState("");
  const [ingestSource, setIngestSource] = useState("conversation");
  const [workspaceName, setWorkspaceName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteConfirmTenantId, setDeleteConfirmTenantId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "member">("member");
  const [activityNow, setActivityNow] = useState(INITIAL_ACTIVITY_NOW);
  const [tags, setTags] = useState("");
  const [type, setType] = useState("fact");
  const [recallDraft, setRecallDraft] = useState(
    recallQuery ?? "recent project context",
  );
  const [lastExport, setLastExport] = useState<GraphExportResult | null>(null);
  const [importConfirmTenantId, setImportConfirmTenantId] = useState("");
  const [importConflictPolicy, setImportConflictPolicy] = useState<
    "skip" | "overwrite"
  >("skip");
  const [importMode, setImportMode] = useState<"replace" | "merge">("merge");
  const [importPayload, setImportPayload] = useState("");
  const [lastImportPreview, setLastImportPreview] =
    useState<GraphImportPreviewResult | null>(null);
  const [lastImportResult, setLastImportResult] =
    useState<GraphImportResult | null>(null);
  const [lastIndexRepair, setLastIndexRepair] =
    useState<IndexRepairResult | null>(null);
  const [lastSourceIngest, setLastSourceIngest] =
    useState<SourceIngestResult | null>(null);
  const [lastAccountDeletion, setLastAccountDeletion] =
    useState<AccountDeletionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usesLocalTenant = isLocalApiUrl(apiUrl);
  const productionDefaultApiUrl = getBrowserProductionDefaultApiUrl();
  const isResolvingProductionApiUrl =
    hasLoadedApiUrl &&
    apiUrl === DEFAULT_API_URL &&
    productionDefaultApiUrl !== null;
  const hasLoadedConnection =
    hasLoadedApiUrl &&
    hasLoadedTenantId &&
    hasLoadedToken &&
    !isResolvingProductionApiUrl;
  const queryClient = useQueryClient();
  const apiBaseUrl = cleanBaseUrl(apiUrl);
  const queryScope = useMemo(
    () => [apiBaseUrl, usesLocalTenant ? tenantId : "session", token] as const,
    [apiBaseUrl, tenantId, token, usesLocalTenant],
  );

  const api = useMemo(
    () =>
      createOpenMemoryClient(apiBaseUrl, {
        tenantId: usesLocalTenant ? tenantId : undefined,
        token: token || undefined,
        credentials: "include",
      }),
    [apiBaseUrl, tenantId, token, usesLocalTenant],
  );
  const sessionQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "session", apiBaseUrl],
    queryFn: () => getSession(apiBaseUrl),
  });
  const sessionUser = sessionQuery.data ?? null;
  const memoriesQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "memories", ...queryScope],
    queryFn: () => api.listMemories(),
  });
  const profileQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "profile", ...queryScope],
    queryFn: () => api.getProfile(),
  });
  const graphStatsQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "graph-stats", ...queryScope],
    queryFn: () => api.getGraphStats(),
  });
  const graphRelationshipsQuery = useQuery({
    enabled: hasLoadedConnection && view === "graph",
    queryKey: ["openmemory", "graph-relationships", ...queryScope],
    queryFn: () => api.getGraphRelationships(),
  });
  const selectedMemoryQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(memoryId),
    queryKey: ["openmemory", "memory", memoryId, ...queryScope],
    queryFn: () => api.getMemory(memoryId ?? ""),
  });
  const neighborsQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(memoryId),
    queryKey: ["openmemory", "neighbors", memoryId, ...queryScope],
    queryFn: () => api.getNeighbors(memoryId ?? ""),
  });
  const oauthConnectionsQuery = useQuery({
    enabled: hasLoadedConnection && !usesLocalTenant && Boolean(sessionUser),
    queryKey: ["openmemory", "oauth-connections", ...queryScope],
    queryFn: () => api.listOAuthConnections().catch(() => []),
  });
  const readinessQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "readiness", ...queryScope],
    queryFn: () => api.getReadiness().catch(() => null),
  });
  const accountQuery = useQuery<Account | null>({
    enabled: hasLoadedConnection && !usesLocalTenant,
    queryKey: ["openmemory", "account", ...queryScope],
    queryFn: () => api.getAccount().catch(() => null),
  });
  const contextQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(recallQuery),
    queryKey: ["openmemory", "context", recallQuery, ...queryScope],
    queryFn: () => api.getContext(recallQuery ?? ""),
  });
  const memories = memoriesQuery.data ?? [];
  const selectedMemory = selectedMemoryQuery.data ?? null;
  const neighbors = neighborsQuery.data ?? [];
  const graphStats = graphStatsQuery.data ?? null;
  const graphRelationships = graphRelationshipsQuery.data ?? [];
  const oauthConnections = oauthConnectionsQuery.data ?? [];
  const readiness = readinessQuery.data ?? null;
  const account = accountQuery.data ?? null;
  const context = contextQuery.data ?? null;
  const profile = profileQuery.data?.summary ?? "";

  useEffect(() => {
    if (
      !hasLoadedApiUrl ||
      (apiUrl !== DEFAULT_API_URL &&
        hasStoredLocalStorageValue("openmemory:apiUrl"))
    ) {
      return;
    }

    const productionApiUrl = productionDefaultApiUrl;
    if (productionApiUrl && apiUrl !== productionApiUrl) {
      setApiUrl(productionApiUrl);
    }
  }, [apiUrl, hasLoadedApiUrl, productionDefaultApiUrl, setApiUrl]);

  const dashboardMetrics = useMemo(
    () => getDashboardMetrics(memories, graphStats, oauthConnections),
    [memories, graphStats, oauthConnections],
  );
  const recentActivity = useMemo(
    () => getRecentActivity(memories, activityNow),
    [activityNow, memories],
  );
  const typeDistribution = useMemo(
    () => getTypeDistribution(memories),
    [memories],
  );
  const lifecycleDistribution = useMemo(
    () => getLifecycleDistribution(memories),
    [memories],
  );
  const tableGlobalFilter = memorySearch ?? "";
  const tableTypeFilter = memoryType ?? "all";
  const tableSorting = useMemo(() => parseMemorySort(memorySort), [memorySort]);
  const graphGlobalFilter = graphSearch ?? "";
  const graphRelationshipFilter = graphRelationship ?? "all";
  const graphTypeFilter = graphType ?? "all";

  useEffect(() => {
    const nextName = account?.user.name ?? sessionUser?.name ?? "";
    if (nextName && !profileName) {
      setProfileName(nextName);
    }
  }, [account?.user.name, profileName, sessionUser?.name]);

  useEffect(() => {
    setActivityNow(new Date());
  }, []);

  const invalidateDashboard = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["openmemory", "memories"] }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "profile"] }),
      queryClient.invalidateQueries({
        queryKey: ["openmemory", "graph-stats"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["openmemory", "oauth-connections"],
      }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "account"] }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "session"] }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "context"] }),
    ]);
  }, [queryClient]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(formatError(caught));
    }
  }, []);

  const refresh = useCallback(async () => {
    await run(invalidateDashboard);
  }, [invalidateDashboard, run]);
  useEffect(() => {
    setRecallDraft(recallQuery ?? "recent project context");
  }, [recallQuery]);
  const selectView = useCallback(
    (nextView: View) => {
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: nextView === "graph" ? previous.memoryId : undefined,
          view: nextView,
        }),
      });
    },
    [navigate],
  );
  const selectMemory = useCallback(
    (nextMemoryId: string | null) => {
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: nextMemoryId ?? undefined,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const updateMemorySearch = useCallback(
    (nextSearch: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memorySearch: nextSearch.trim() ? nextSearch : undefined,
          view: "recall",
        }),
      });
    },
    [navigate],
  );
  const updateMemoryType = useCallback(
    (nextType: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memoryType: nextType === "all" ? undefined : nextType,
          view: "recall",
        }),
      });
    },
    [navigate],
  );
  const updateMemorySorting = useCallback(
    (updater: Updater<MemoryTableSorting>) => {
      const nextSorting =
        typeof updater === "function" ? updater(tableSorting) : updater;

      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memorySort: serializeMemorySort(nextSorting),
          view: "recall",
        }),
      });
    },
    [navigate, tableSorting],
  );
  const updateGraphSearch = useCallback(
    (nextSearch: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          graphSearch: nextSearch.trim() ? nextSearch : undefined,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const updateGraphType = useCallback(
    (nextType: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          graphType: nextType === "all" ? undefined : nextType,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const updateGraphRelationship = useCallback(
    (nextRelationship: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          graphRelationship:
            nextRelationship === "all" ? undefined : nextRelationship,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const submitRecallQuery = useCallback(
    (nextQuery: string) => {
      const trimmedQuery = nextQuery.trim();
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          recallQuery: trimmedQuery || undefined,
          view: "recall",
        }),
      });
    },
    [navigate],
  );

  const createMemoryMutation = useMutation({
    mutationFn: api.createMemory,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const ingestSourceMutation = useMutation({
    mutationFn: api.ingestSource,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => {
      setError(null);
      setLastSourceIngest(null);
    },
    onSuccess: invalidateDashboard,
  });
  const forgetMemoryMutation = useMutation({
    mutationFn: api.forgetMemory,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const authMutation = useMutation({
    mutationFn: ({
      path,
      body,
    }: {
      path: string;
      body: Record<string, unknown>;
    }) => authRequest(apiBaseUrl, path, body),
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const revokeOAuthMutation = useMutation({
    mutationFn: api.revokeOAuthConnection,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const renameWorkspaceMutation = useMutation({
    mutationFn: api.renameWorkspace,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const updateProfileMutation = useMutation({
    mutationFn: api.updateAccountProfile,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const inviteMemberMutation = useMutation({
    mutationFn: api.inviteWorkspaceMember,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setMemberEmail("");
      await invalidateDashboard();
    },
  });
  const removeMemberMutation = useMutation({
    mutationFn: api.removeWorkspaceMember,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const deleteAccountMutation = useMutation({
    mutationFn: api.deleteAccount,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      setLastAccountDeletion(result);
      setDeleteConfirmEmail("");
      setDeleteConfirmTenantId("");
      queryClient.setQueryData(["openmemory", "session", apiBaseUrl], null);
      queryClient.setQueryData(["openmemory", "memories", ...queryScope], []);
      queryClient.setQueryData(["openmemory", "profile", ...queryScope], {
        summary: "",
      });
      queryClient.setQueryData(
        ["openmemory", "oauth-connections", ...queryScope],
        [],
      );
      queryClient.setQueryData(["openmemory", "account", ...queryScope], null);
      queryClient.setQueryData(
        ["openmemory", "readiness", ...queryScope],
        null,
      );
      queryClient.removeQueries({ queryKey: ["openmemory", "context"] });
      await queryClient.invalidateQueries({
        queryKey: ["openmemory", "session"],
      });
    },
  });
  const exportGraphMutation = useMutation({
    mutationFn: api.exportGraph,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: (result) => setLastExport(result),
  });
  const importPreviewMutation = useMutation({
    mutationFn: api.previewGraphImport,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: (result) => setLastImportPreview(result),
  });
  const importGraphMutation = useMutation({
    mutationFn: api.importGraph,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      setLastImportResult(result);
      await invalidateDashboard();
    },
  });
  const repairIndexMutation = useMutation({
    mutationFn: api.repairIndex,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: (result) => setLastIndexRepair(result),
  });
  const isLoading =
    sessionQuery.isFetching ||
    memoriesQuery.isFetching ||
    profileQuery.isFetching ||
    graphStatsQuery.isFetching ||
    graphRelationshipsQuery.isFetching ||
    selectedMemoryQuery.isFetching ||
    neighborsQuery.isFetching ||
    accountQuery.isFetching ||
    oauthConnectionsQuery.isFetching ||
    readinessQuery.isFetching ||
    contextQuery.isFetching ||
    createMemoryMutation.isPending ||
    ingestSourceMutation.isPending ||
    forgetMemoryMutation.isPending ||
    authMutation.isPending ||
    revokeOAuthMutation.isPending ||
    renameWorkspaceMutation.isPending ||
    updateProfileMutation.isPending ||
    inviteMemberMutation.isPending ||
    removeMemberMutation.isPending ||
    deleteAccountMutation.isPending ||
    exportGraphMutation.isPending ||
    importPreviewMutation.isPending ||
    importGraphMutation.isPending ||
    repairIndexMutation.isPending;

  async function remember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createMemoryMutation.mutateAsync({
      content,
      type,
      tags: parseTags(tags),
    });
    setContent("");
    setTags("");
  }

  async function recall(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    submitRecallQuery(recallDraft);
  }

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await ingestSourceMutation.mutateAsync({
      content: ingestContent,
      source: ingestSource,
      tags: parseTags(tags),
    });
    setIngestContent("");
    setLastSourceIngest(result);
  }

  async function inspectMemory(id: string) {
    selectMemory(id);
  }

  async function forget(id: string) {
    await forgetMemoryMutation.mutateAsync(id);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authMutation.mutateAsync({
      path: "/api/auth/sign-in/email",
      body: {
        email,
        password,
        rememberMe: true,
      },
    });
    setPassword("");
  }

  async function signUp() {
    await authMutation.mutateAsync({
      path: "/api/auth/sign-up/email",
      body: {
        email,
        password,
        name: name || email,
      },
    });
    setPassword("");
  }

  async function signOut() {
    await authMutation.mutateAsync({
      path: "/api/auth/sign-out",
      body: {},
    });
    queryClient.setQueryData(["openmemory", "session", apiBaseUrl], null);
    queryClient.setQueryData(["openmemory", "memories", ...queryScope], []);
    queryClient.setQueryData(["openmemory", "profile", ...queryScope], {
      summary: "",
    });
    queryClient.setQueryData(
      ["openmemory", "oauth-connections", ...queryScope],
      [],
    );
    queryClient.setQueryData(["openmemory", "account", ...queryScope], null);
    queryClient.removeQueries({ queryKey: ["openmemory", "context"] });
  }

  async function revokeOAuthConnection(clientId: string) {
    await revokeOAuthMutation.mutateAsync(clientId);
  }

  async function renameCurrentWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = workspaceName.trim() || account?.workspace.name;
    if (!nextName) {
      return;
    }

    await renameWorkspaceMutation.mutateAsync(nextName);
  }

  async function saveCurrentProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = profileName.trim() || account?.user.name;
    if (!nextName) {
      return;
    }

    await updateProfileMutation.mutateAsync(nextName);
  }

  async function inviteCurrentMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const emailToInvite = memberEmail.trim();
    if (!emailToInvite) {
      return;
    }

    await inviteMemberMutation.mutateAsync({
      email: emailToInvite,
      role: memberRole,
    });
  }

  async function removeCurrentMember(memberId: string) {
    await removeMemberMutation.mutateAsync(memberId);
  }

  async function deleteCurrentAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      return;
    }

    await deleteAccountMutation.mutateAsync({
      confirmEmail: deleteConfirmEmail,
      confirmTenantId: deleteConfirmTenantId,
    });
  }

  async function exportGraph() {
    await exportGraphMutation.mutateAsync();
  }

  async function previewImportGraph(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const graphExport = parseImportPayload(importPayload);
    if (!graphExport) {
      return;
    }

    await importPreviewMutation.mutateAsync({
      confirmTenantId: importConfirmTenantId.trim(),
      conflictPolicy: importConflictPolicy,
      export: graphExport,
      mode: importMode,
    });
  }

  async function importGraph() {
    const graphExport = parseImportPayload(importPayload);
    if (!graphExport) {
      return;
    }

    await importGraphMutation.mutateAsync({
      confirmTenantId: importConfirmTenantId.trim(),
      conflictPolicy: importConflictPolicy,
      export: graphExport,
      mode: importMode,
    });
  }

  async function repairIndex() {
    await repairIndexMutation.mutateAsync();
  }

  function parseImportPayload(value: string) {
    try {
      setError(null);
      return JSON.parse(value) as unknown;
    } catch {
      setError("Import payload must be valid JSON.");
      return null;
    }
  }

  const queryError = contextQuery.error
    ? formatError(contextQuery.error)
    : null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            OM
          </div>
          <div>
            <h1>OpenMemory</h1>
            <p>Hosted graph memory for AI tools.</p>
          </div>
        </div>

        <SidebarNav activeView={view} onSelect={selectView} />

        <Card className="sidebar-section">
          <div className="section-label">Connection</div>
          <div className="field">
            <Label htmlFor="apiUrl">API URL</Label>
            <Input
              id="apiUrl"
              onChange={(event) => setApiUrl(event.target.value)}
              value={apiUrl}
            />
          </div>
          <div className="field">
            <Label htmlFor="tenant">Tenant</Label>
            <Input
              disabled={!usesLocalTenant}
              id="tenant"
              onChange={(event) => setTenantId(event.target.value)}
              value={tenantId}
            />
          </div>
          <div className="field">
            <Label htmlFor="token">Bearer token</Label>
            <Input
              id="token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="Optional"
              type="password"
              value={token}
            />
          </div>
        </Card>

        <AccountStatus
          onSignOut={signOut}
          sessionUser={sessionUser}
          tenantId={tenantId}
          usesLocalTenant={usesLocalTenant}
        />

        <Card className="sidebar-section capture-section">
          <form className="stack" onSubmit={remember}>
            <div className="section-label">Capture</div>
            <div className="field">
              <Label htmlFor="content">Memory</Label>
              <Textarea
                id="content"
                onChange={(event) => setContent(event.target.value)}
                placeholder="Save a fact, preference, decision, episode, or insight."
                required
                value={content}
              />
            </div>
            <div className="row">
              <div className="field">
                <Label htmlFor="type">Type</Label>
                <Select
                  id="type"
                  onChange={(event) => setType(event.target.value)}
                  value={type}
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="decision">Decision</option>
                  <option value="episode">Episode</option>
                  <option value="insight">Insight</option>
                  <option value="profile">Profile</option>
                </Select>
              </div>
              <div className="field">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="work, project"
                  value={tags}
                />
              </div>
            </div>
            <Button disabled={isLoading || !content.trim()} type="submit">
              Remember
            </Button>
          </form>
        </Card>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">OpenMemory Control Plane</p>
            <h2>Memory Dashboard</h2>
            <p>
              Inspect graph health, capture context, and manage the MCP surface
              that feeds external AI tools.
            </p>
          </div>
          <div className="header-actions">
            <div className="runtime-pill">
              <span>{usesLocalTenant ? "Local worker" : "Hosted worker"}</span>
              <strong>{sessionUser ? sessionUser.email : tenantId}</strong>
            </div>
            <Button
              disabled={isLoading}
              onClick={() => void refresh()}
              type="button"
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </header>

        <Suspense fallback={<DashboardOverviewSkeleton />}>
          <DashboardOverview
            lifecycleDistribution={lifecycleDistribution}
            memories={memories}
            metrics={dashboardMetrics}
            readiness={readiness}
            recentActivity={recentActivity}
            typeDistribution={typeDistribution}
          />
        </Suspense>

        <TabsList aria-label="Workspace views" className="tabs">
          {(
            ["recall", "ingest", "graph", "mcp", "operations", "admin"] as const
          ).map((item) => (
            <TabsTrigger
              active={view === item}
              aria-selected={view === item}
              key={item}
              onClick={() => selectView(item)}
              type="button"
            >
              {VIEW_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>

        <form className="toolbar" onSubmit={recall}>
          <Input
            aria-label="Recall query"
            onChange={(event) => setRecallDraft(event.target.value)}
            placeholder="Ask for context"
            value={recallDraft}
          />
          <Button disabled={isLoading || !recallDraft.trim()} type="submit">
            <Send aria-hidden="true" />
            Recall
          </Button>
        </form>

        {error || queryError ? (
          <div className="error">{error ?? queryError}</div>
        ) : null}

        <div
          className={
            view === "admin" || view === "graph"
              ? "workspace workspace-wide"
              : "workspace"
          }
        >
          <div className="panel">
            {view === "ingest" ? (
              <div className="stack">
                <form className="stack" onSubmit={ingest}>
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">Pipeline</p>
                      <h2>Ingest Source</h2>
                    </div>
                  </div>
                  <div className="field">
                    <Label htmlFor="ingestSource">Source</Label>
                    <Input
                      id="ingestSource"
                      onChange={(event) => setIngestSource(event.target.value)}
                      value={ingestSource}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="ingestContent">Content</Label>
                    <Textarea
                      id="ingestContent"
                      onChange={(event) => setIngestContent(event.target.value)}
                      required
                      value={ingestContent}
                    />
                  </div>
                  <Button
                    disabled={isLoading || !ingestContent.trim()}
                    type="submit"
                  >
                    Ingest
                  </Button>
                </form>
                <SourceIngestSummaryPanel
                  onInspect={inspectMemory}
                  result={lastSourceIngest}
                />
              </div>
            ) : view === "graph" ? (
              <div className="stack">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Graph</p>
                    <h2>Knowledge Map</h2>
                  </div>
                </div>
                <GraphStatsPanel stats={graphStats} />
                <GraphOperationsPanel metrics={dashboardMetrics} />
                <KnowledgeMap
                  graphRelationship={graphRelationshipFilter}
                  graphSearch={graphGlobalFilter}
                  graphType={graphTypeFilter}
                  relationshipCatalog={graphRelationships}
                  memories={memories}
                  neighbors={neighbors}
                  onGraphRelationshipChange={updateGraphRelationship}
                  onGraphSearchChange={updateGraphSearch}
                  onGraphTypeChange={updateGraphType}
                  onInspect={inspectMemory}
                  selectedMemoryId={selectedMemory?.id ?? null}
                />
                <div className="row">
                  <Button
                    disabled={isLoading}
                    onClick={() => void exportGraph()}
                    type="button"
                    variant="outline"
                  >
                    Export
                  </Button>
                  <Button
                    disabled={isLoading}
                    onClick={() => void repairIndex()}
                    type="button"
                    variant="outline"
                  >
                    Repair index
                  </Button>
                  {lastExport ? (
                    <span className="muted">
                      {lastExport.memoryCount} memories exported
                    </span>
                  ) : null}
                  {lastIndexRepair ? (
                    <span className="muted">
                      {lastIndexRepair.attempted} memories queued ·{" "}
                      {lastIndexRepair.staleVectors.attempted} stale checked
                    </span>
                  ) : null}
                </div>
                <GraphImportPanel
                  conflictPolicy={importConflictPolicy}
                  confirmTenantId={importConfirmTenantId}
                  importMode={importMode}
                  isImporting={importGraphMutation.isPending}
                  isLoading={isLoading}
                  isPreviewing={importPreviewMutation.isPending}
                  lastImportResult={lastImportResult}
                  lastPreview={lastImportPreview}
                  onConflictPolicyChange={(nextPolicy) => {
                    setImportConflictPolicy(nextPolicy);
                    setLastImportPreview(null);
                    setLastImportResult(null);
                  }}
                  onConfirmTenantIdChange={(nextTenantId) => {
                    setImportConfirmTenantId(nextTenantId);
                    setLastImportPreview(null);
                    setLastImportResult(null);
                  }}
                  onImport={() => void importGraph()}
                  onModeChange={(nextMode) => {
                    setImportMode(nextMode);
                    setLastImportPreview(null);
                    setLastImportResult(null);
                  }}
                  onPayloadChange={(nextPayload) => {
                    setImportPayload(nextPayload);
                    setLastImportPreview(null);
                    setLastImportResult(null);
                  }}
                  onPreview={previewImportGraph}
                  payload={importPayload}
                />
                <MemoryDetail
                  memory={selectedMemory}
                  memories={memories}
                  neighbors={neighbors}
                  onForget={forget}
                  onInspect={inspectMemory}
                />
              </div>
            ) : view === "mcp" ? (
              <McpSetup
                apiUrl={apiUrl}
                connections={oauthConnections}
                onRevoke={revokeOAuthConnection}
              />
            ) : view === "operations" ? (
              <OperationsReadiness
                apiUrl={apiUrl}
                graphStats={graphStats}
                isLoading={isLoading}
                onRefresh={refresh}
                readiness={readiness}
              />
            ) : view === "admin" ? (
              <AdminWorkspace
                account={account}
                apiUrl={apiUrl}
                connections={oauthConnections}
                deleteConfirmEmail={deleteConfirmEmail}
                deleteConfirmTenantId={deleteConfirmTenantId}
                email={email}
                isLoading={isLoading}
                lastAccountDeletion={lastAccountDeletion}
                memberEmail={memberEmail}
                memberRole={memberRole}
                name={name}
                onDeleteAccount={deleteCurrentAccount}
                onInviteMember={inviteCurrentMember}
                onRevoke={revokeOAuthConnection}
                onRemoveMember={removeCurrentMember}
                onSaveProfile={saveCurrentProfile}
                onRenameWorkspace={renameCurrentWorkspace}
                onSignIn={signIn}
                onSignOut={signOut}
                onSignUp={signUp}
                password={password}
                profileName={profileName || account?.user.name || name}
                sessionUser={sessionUser}
                setApiUrl={setApiUrl}
                setDeleteConfirmEmail={setDeleteConfirmEmail}
                setDeleteConfirmTenantId={setDeleteConfirmTenantId}
                setEmail={setEmail}
                setMemberEmail={setMemberEmail}
                setMemberRole={setMemberRole}
                setName={setName}
                setPassword={setPassword}
                setProfileName={setProfileName}
                setTenantId={setTenantId}
                setToken={setToken}
                setWorkspaceName={setWorkspaceName}
                tenantId={tenantId}
                token={token}
                usesLocalTenant={usesLocalTenant}
                workspaceName={
                  workspaceName ||
                  account?.workspace.name ||
                  (usesLocalTenant ? "Local workspace" : "")
                }
              />
            ) : (
              <>
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Recall</p>
                    <h2>Memories</h2>
                  </div>
                </div>
                {memories.length === 0 ? (
                  <OnboardingEmptyState
                    hasSession={Boolean(sessionUser)}
                    onGoToAdmin={() => selectView("admin")}
                    onGoToIngest={() => selectView("ingest")}
                  />
                ) : (
                  <MemoryDataTable
                    globalFilter={tableGlobalFilter}
                    memories={memories}
                    onForget={forget}
                    onGlobalFilterChange={updateMemorySearch}
                    onInspect={inspectMemory}
                    onSortingChange={updateMemorySorting}
                    onTypeFilterChange={updateMemoryType}
                    sorting={tableSorting}
                    typeFilter={tableTypeFilter}
                  />
                )}
              </>
            )}
          </div>

          {view === "admin" ? null : (
            <div className="stack">
              <div className="panel">
                <div className="panel-title compact">
                  <h2>Context</h2>
                </div>
                <pre className="context">
                  {contextQuery.isFetching
                    ? "Assembling graph context..."
                    : context?.context ||
                      "Run recall to assemble graph context."}
                </pre>
              </div>
              <div className="panel">
                <div className="panel-title compact">
                  <h2>Profile</h2>
                </div>
                <pre className="context">{profile || "No profile yet."}</pre>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function OnboardingEmptyState({
  hasSession,
  onGoToAdmin,
  onGoToIngest,
}: Readonly<{
  hasSession: boolean;
  onGoToAdmin: () => void;
  onGoToIngest: () => void;
}>) {
  return (
    <div className="empty-state onboarding-empty">
      <h3>Start your memory graph</h3>
      <p>
        Capture a short fact from the sidebar, ingest a source document, or
        connect an MCP client so external AI tools can read and write context.
      </p>
      <div className="onboarding-steps">
        <span>1. Save a profile or project memory</span>
        <span>2. Ingest source notes for graph edges</span>
        <span>3. Connect MCP after OAuth sign-in</span>
      </div>
      <div className="row">
        <Button onClick={onGoToIngest} type="button" variant="outline">
          Ingest source
        </Button>
        <Button onClick={onGoToAdmin} type="button" variant="outline">
          {hasSession ? "Review account" : "Sign in"}
        </Button>
      </div>
    </div>
  );
}

function OperationsReadiness({
  apiUrl,
  graphStats,
  isLoading,
  onRefresh,
  readiness,
}: Readonly<{
  apiUrl: string;
  graphStats: GraphStats | null;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  readiness: ReadinessSnapshot | null;
}>) {
  const summary = getReadinessSummary(readiness);
  const semanticIndex = readiness?.semanticIndex ?? null;
  const bindingRows = readiness
    ? Object.entries(readiness.bindings).map(([key, configured]) => ({
        configured,
        key,
        label: formatBindingLabel(key),
      }))
    : [];
  const warningRows = readiness?.warnings ?? [];

  return (
    <section className="operations-stack" aria-label="Operations readiness">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Launch readiness</p>
          <h2>Operations</h2>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void onRefresh()}
          type="button"
        >
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="readiness-grid">
        <ReadinessCard
          icon={<ServerCog aria-hidden="true" />}
          label="Bindings"
          status={`${summary.configuredBindings}/${summary.totalBindings}`}
          tone={
            summary.configuredBindings === summary.totalBindings
              ? "good"
              : "warn"
          }
          value="Cloudflare services"
        />
        <ReadinessCard
          icon={<GitBranch aria-hidden="true" />}
          label="Graph"
          status={summary.graphStatus}
          tone={summary.graphStatus === "Typed graph" ? "good" : "warn"}
          value={`${readiness?.graph.totalEdges ?? graphStats?.totalEdges ?? 0} edges`}
        />
        <ReadinessCard
          icon={<Plug aria-hidden="true" />}
          label="MCP"
          status={summary.mcpStatus}
          tone={summary.mcpStatus === "Discoverable" ? "good" : "warn"}
          value={`${readiness?.mcp.tools.length ?? 0} tools`}
        />
        <ReadinessCard
          icon={<Database aria-hidden="true" />}
          label="Semantic index"
          status={formatSemanticIndexStatus(semanticIndex?.status)}
          tone={
            semanticIndex?.status === "current" ||
            semanticIndex?.status === undefined
              ? "good"
              : "warn"
          }
          value={`${semanticIndex?.expectedVectors ?? 0} current · ${semanticIndex?.staleVectorCandidates ?? 0} stale`}
        />
        <ReadinessCard
          icon={
            summary.warningCount === 0 ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <AlertTriangle aria-hidden="true" />
            )
          }
          label="Warnings"
          status={String(summary.warningCount)}
          tone={summary.warningCount === 0 ? "good" : "warn"}
          value={summary.productionReady ? "Ready signal" : "Needs review"}
        />
      </div>

      <div className="operations-grid">
        <section className="operations-card">
          <div className="panel-heading">
            <span>Tenant and auth</span>
            <Badge variant="outline">
              {readiness?.tenant.source ?? "loading"}
            </Badge>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Tenant</dt>
              <dd>{readiness?.tenant.id ?? "Loading"}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{readiness?.auth.mode ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Better Auth URL</dt>
              <dd>{readiness?.auth.betterAuthUrl ?? cleanBaseUrl(apiUrl)}</dd>
            </div>
            <div>
              <dt>Providers</dt>
              <dd>
                GitHub {readiness?.auth.socialProviders.github ? "on" : "off"} ·
                Google {readiness?.auth.socialProviders.google ? "on" : "off"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="operations-card">
          <div className="panel-heading">
            <span>MCP discovery</span>
            <Badge>{summary.mcpStatus}</Badge>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Endpoint</dt>
              <dd>
                {readiness?.mcp.endpoint ?? `${cleanBaseUrl(apiUrl)}/mcp`}
              </dd>
            </div>
            <div>
              <dt>Authorization</dt>
              <dd>{readiness?.mcp.authorizationServer ?? "Loading"}</dd>
            </div>
            <div>
              <dt>Protected resource</dt>
              <dd>{readiness?.mcp.protectedResource ?? "Loading"}</dd>
            </div>
            <div>
              <dt>Tools</dt>
              <dd>{readiness?.mcp.tools.join(", ") ?? "Loading"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="operations-card">
        <div className="panel-heading">
          <span>Semantic index</span>
          <Badge
            className={
              semanticIndex?.repairRecommended
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : undefined
            }
            variant="outline"
          >
            {formatSemanticIndexStatus(semanticIndex?.status)}
          </Badge>
        </div>
        <dl className="definition-list">
          <div>
            <dt>Expected vectors</dt>
            <dd>{semanticIndex?.expectedVectors ?? 0}</dd>
          </div>
          <div>
            <dt>Stale candidates</dt>
            <dd>{semanticIndex?.staleVectorCandidates ?? 0}</dd>
          </div>
          <div>
            <dt>Checked sample</dt>
            <dd>{semanticIndex?.checkedVectorSample ?? 0}</dd>
          </div>
          <div>
            <dt>Missing sample</dt>
            <dd>{semanticIndex?.missingVectorSample.join(", ") || "None"}</dd>
          </div>
          <div>
            <dt>Stale sample</dt>
            <dd>{semanticIndex?.staleVectorSample.join(", ") || "None"}</dd>
          </div>
        </dl>
      </section>

      <section className="operations-card">
        <div className="panel-heading">
          <span>Cloudflare bindings</span>
          <strong>{summary.configuredBindings} configured</strong>
        </div>
        <div className="binding-grid">
          {bindingRows.map((binding) => (
            <div
              className={
                binding.configured ? "binding-pill configured" : "binding-pill"
              }
              key={binding.key}
            >
              {binding.configured ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <AlertTriangle aria-hidden="true" />
              )}
              <span>{binding.label}</span>
            </div>
          ))}
          {bindingRows.length === 0 ? (
            <div className="empty-state compact">
              <h3>Readiness loading</h3>
              <p>Refresh once the API connection is available.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="operations-card">
        <div className="panel-heading">
          <span>Warnings</span>
          <strong>{warningRows.length}</strong>
        </div>
        {warningRows.length === 0 ? (
          <div className="status-strip success">
            <CheckCircle2 aria-hidden="true" />
            <span>
              <strong>No readiness warnings</strong>
              <small>
                Current tenant and configured bindings look consistent.
              </small>
            </span>
          </div>
        ) : (
          <ul className="warning-list">
            {warningRows.map((warning) => (
              <li key={warning}>
                <AlertTriangle aria-hidden="true" />
                <span>{formatWarningLabel(warning)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ReadinessCard({
  icon,
  label,
  status,
  tone,
  value,
}: Readonly<{
  icon: ReactNode;
  label: string;
  status: string;
  tone: "good" | "warn";
  value: string;
}>) {
  return (
    <div className={`readiness-card ${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{status}</strong>
      <small>{value}</small>
    </div>
  );
}

function SidebarNav({
  activeView,
  onSelect,
}: Readonly<{
  activeView: View;
  onSelect: (view: View) => void;
}>) {
  const items: Array<{
    view: View;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      view: "recall",
      label: "Dashboard",
      description: "Memories and recall context",
      icon: <Database aria-hidden="true" />,
    },
    {
      view: "ingest",
      label: "Sources",
      description: "Documents and long-form context",
      icon: <FileText aria-hidden="true" />,
    },
    {
      view: "graph",
      label: "Knowledge Map",
      description: "Graph inspection and repair",
      icon: <Network aria-hidden="true" />,
    },
    {
      view: "operations",
      label: "Operations",
      description: "Readiness and launch evidence",
      icon: <ServerCog aria-hidden="true" />,
    },
    {
      view: "admin",
      label: "Admin",
      description: "Account, tenants, and access",
      icon: <ShieldCheck aria-hidden="true" />,
    },
    {
      view: "mcp",
      label: "MCP",
      description: "Client setup and connections",
      icon: <Plug aria-hidden="true" />,
    },
  ];

  return (
    <nav aria-label="Main navigation" className="sidebar-nav">
      <div className="section-label">Workspace</div>
      {items.map((item) => (
        <button
          className={activeView === item.view ? "nav-item active" : "nav-item"}
          key={item.view}
          onClick={() => onSelect(item.view)}
          type="button"
        >
          {item.icon}
          <span>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
        </button>
      ))}
    </nav>
  );
}

function DashboardOverviewSkeleton() {
  return (
    <section
      aria-label="Memory overview loading"
      className="overview-grid overview-grid-loading"
    >
      {OVERVIEW_SKELETON_TILES.map((tile, index) => (
        <div
          aria-hidden="true"
          className={index === 0 ? "metric-tile featured" : "metric-tile"}
          key={tile}
        >
          <span className="skeleton-line skeleton-line-short" />
          <strong className="skeleton-line skeleton-line-title" />
          <small className="skeleton-line" />
        </div>
      ))}
    </section>
  );
}

function SourceIngestSummaryPanel({
  onInspect,
  result,
}: Readonly<{
  onInspect: (id: string) => Promise<void>;
  result: SourceIngestResult | null;
}>) {
  if (!result) {
    return (
      <section
        className="source-result-panel empty"
        aria-label="Source ingest summary"
      >
        <span>No source ingested yet</span>
        <p>Submit a document to create chunk memories and graph edges.</p>
      </section>
    );
  }

  const summary = getSourceIngestSummary(result);
  const firstMemoryId = result.memories[0]?.id ?? null;

  return (
    <section className="source-result-panel" aria-label="Source ingest summary">
      <div className="panel-heading">
        <span>Source indexed</span>
        <strong>{summary.sourceId}</strong>
      </div>
      <ul className="source-result-grid">
        <li>
          <span>Chunks</span>
          <strong>{summary.chunkCount}</strong>
        </li>
        <li>
          <span>Memories</span>
          <strong>{summary.memoryCount}</strong>
        </li>
        <li>
          <span>Edges</span>
          <strong>{summary.edgeCount}</strong>
        </li>
        <li>
          <span>Leading type</span>
          <strong>{summary.leadingType}</strong>
        </li>
      </ul>
      {firstMemoryId ? (
        <Button
          onClick={() => void onInspect(firstMemoryId)}
          size="sm"
          type="button"
          variant="outline"
        >
          Inspect first chunk
        </Button>
      ) : null}
    </section>
  );
}

function MemoryDetail({
  memory,
  memories,
  neighbors,
  onForget,
  onInspect,
}: Readonly<{
  memory: Memory | null;
  memories: Memory[];
  neighbors: GraphEdge[];
  onForget: (id: string) => Promise<void>;
  onInspect: (id: string) => Promise<void>;
}>) {
  if (!memory) {
    return <p className="muted">Select a memory to inspect its graph.</p>;
  }
  const neighborDetails = getMemoryNeighborDetails(memory, neighbors, memories);

  return (
    <div className="stack">
      <h2>Memory Detail</h2>
      <article className="memory">
        <p>{memory.content}</p>
        <MemoryMeta memory={memory} />
        <Button
          onClick={() => void onForget(memory.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          Forget
        </Button>
      </article>
      <h2>Neighbors</h2>
      {neighborDetails.length === 0 ? (
        <p className="muted">No graph neighbors yet.</p>
      ) : (
        <ul className="neighbor-list" aria-label="Graph neighbor relationships">
          {neighborDetails.map((detail) => (
            <li
              className="neighbor-card"
              key={`${detail.edge.sourceId}:${detail.edge.relationship}:${detail.edge.targetId}`}
            >
              <div className="neighbor-card-header">
                <span className="pill">{detail.edge.relationship}</span>
                <span>{detail.edge.weight.toFixed(2)}</span>
              </div>
              <div>
                <strong>
                  {detail.direction === "outgoing" ? "To" : "From"} ·{" "}
                  {detail.relatedMemory?.type ?? "External memory"}
                </strong>
                <p>
                  {detail.relatedMemory?.content ??
                    `Memory ${detail.relatedMemoryId}`}
                </p>
              </div>
              {detail.relatedMemory ? (
                <Button
                  onClick={() => void onInspect(detail.relatedMemoryId)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Inspect
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GraphStatsPanel({ stats }: Readonly<{ stats: GraphStats | null }>) {
  if (!stats) {
    return <p className="muted">Graph stats unavailable.</p>;
  }

  return (
    <div className="graph-stats-layout">
      <div className="stats-grid">
        <Stat label="Active" value={stats.activeMemories} />
        <Stat label="Historical" value={stats.historicalMemories} />
        <Stat label="Edges" value={stats.totalEdges} />
        <Stat label="Entities" value={stats.entityCount} />
      </div>
      <div className="relationship-health">
        <div>
          <span>Graph density</span>
          <strong>{stats.graphDensity.toFixed(3)}</strong>
          <small>{stats.relationshipCount} typed relationship classes</small>
        </div>
        <ul aria-label="Top graph relationships">
          {stats.relationshipDistribution.slice(0, 4).map((relationship) => (
            <li key={relationship.relationship}>
              <span>{relationship.label}</span>
              <strong>{relationship.count}</strong>
              <small>{relationship.category}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GraphOperationsPanel({
  metrics,
}: Readonly<{ metrics: DashboardMetrics }>) {
  const summary = getGraphOperationsSummary(metrics);

  return (
    <section
      aria-label="Graph operations dashboard"
      className="operations-panel"
    >
      <div>
        <span>Benchmark status</span>
        <strong>{summary.status}</strong>
        <small>{summary.traversalBudget}</small>
      </div>
      <div>
        <span>Average degree</span>
        <strong>{summary.averageDegree}</strong>
        <small>{summary.relationshipTypes} relationship types</small>
      </div>
      <div>
        <span>Fixture size</span>
        <strong>{summary.benchmarkSize}</strong>
        <small>active graph nodes</small>
      </div>
    </section>
  );
}

function GraphImportPanel({
  conflictPolicy,
  confirmTenantId,
  importMode,
  isImporting,
  isLoading,
  isPreviewing,
  lastImportResult,
  lastPreview,
  onConflictPolicyChange,
  onConfirmTenantIdChange,
  onImport,
  onModeChange,
  onPayloadChange,
  onPreview,
  payload,
}: Readonly<{
  conflictPolicy: "skip" | "overwrite";
  confirmTenantId: string;
  importMode: "replace" | "merge";
  isImporting: boolean;
  isLoading: boolean;
  isPreviewing: boolean;
  lastImportResult: GraphImportResult | null;
  lastPreview: GraphImportPreviewResult | null;
  onConflictPolicyChange: (policy: "skip" | "overwrite") => void;
  onConfirmTenantIdChange: (tenantId: string) => void;
  onImport: () => void;
  onModeChange: (mode: "replace" | "merge") => void;
  onPayloadChange: (payload: string) => void;
  onPreview: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  payload: string;
}>) {
  const summary = getGraphImportPreviewSummary(lastPreview);
  const fieldConflicts = lastPreview?.conflicts.fieldConflicts ?? [];
  const canPreview =
    confirmTenantId.trim().length > 0 &&
    payload.trim().length > 0 &&
    !isLoading &&
    !isPreviewing;
  const canImport =
    Boolean(lastPreview) &&
    lastPreview?.tenantId === confirmTenantId.trim() &&
    !isLoading &&
    !isImporting;

  return (
    <section
      aria-label="Graph import preview"
      className="operations-card graph-import-panel"
    >
      <div className="panel-title">
        <div>
          <p className="eyebrow">Restore</p>
          <h2>Import Preview</h2>
        </div>
        <Badge
          className={`graph-import-status ${summary.tone}`}
          variant={summary.tone === "good" ? "default" : "secondary"}
        >
          {summary.status}
        </Badge>
      </div>
      <form
        className="graph-import-form"
        onSubmit={(event) => void onPreview(event)}
      >
        <div className="field">
          <Label htmlFor="importConfirmTenantId">Confirm tenant id</Label>
          <Input
            id="importConfirmTenantId"
            onChange={(event) => onConfirmTenantIdChange(event.target.value)}
            placeholder="tenant-id"
            value={confirmTenantId}
          />
        </div>
        <div className="field">
          <Label htmlFor="importMode">Import mode</Label>
          <Select
            id="importMode"
            onChange={(event) =>
              onModeChange(event.target.value as "replace" | "merge")
            }
            value={importMode}
          >
            <option value="merge">Merge</option>
            <option value="replace">Replace</option>
          </Select>
        </div>
        <div className="field">
          <Label htmlFor="importConflictPolicy">Conflict policy</Label>
          <Select
            disabled={importMode === "replace"}
            id="importConflictPolicy"
            onChange={(event) =>
              onConflictPolicyChange(event.target.value as "skip" | "overwrite")
            }
            value={conflictPolicy}
          >
            <option value="skip">Skip changed duplicates</option>
            <option value="overwrite">Overwrite changed duplicates</option>
          </Select>
        </div>
        <div className="field graph-import-payload">
          <Label htmlFor="importPayload">Graph export JSON</Label>
          <Textarea
            id="importPayload"
            onChange={(event) => onPayloadChange(event.target.value)}
            placeholder={`{"version":1,"exportedAt":"2026-07-18T00:00:00.000Z","memories":[],"edges":[]}`}
            value={payload}
          />
        </div>
        <div className="graph-import-actions">
          <Button disabled={!canPreview} type="submit" variant="outline">
            {isPreviewing ? "Previewing" : "Preview import"}
          </Button>
          <Button
            disabled={!canImport}
            onClick={() => onImport()}
            type="button"
            variant={
              lastPreview?.mode === "replace" ? "destructive" : "default"
            }
          >
            {isImporting ? "Importing" : "Import graph"}
          </Button>
        </div>
      </form>
      {lastPreview ? (
        <section
          aria-label="Graph import preview summary"
          className="source-result-panel"
        >
          <div className="panel-heading">
            <span>Previewed tenant</span>
            <strong>{lastPreview.tenantId}</strong>
          </div>
          <ul className="source-result-grid graph-import-summary-grid">
            <li>
              <span>Incoming</span>
              <strong>{summary.memoriesImported}</strong>
            </li>
            <li>
              <span>New</span>
              <strong>{summary.newMemories}</strong>
            </li>
            <li>
              <span>Changed</span>
              <strong>{summary.changedDuplicates}</strong>
            </li>
            <li>
              <span>Edges</span>
              <strong>{summary.edgesImported}</strong>
            </li>
            <li>
              <span>Would skip</span>
              <strong>{summary.memoriesSkipped}</strong>
            </li>
            <li>
              <span>Would overwrite</span>
              <strong>{summary.memoriesOverwritten}</strong>
            </li>
            <li>
              <span>Duplicates</span>
              <strong>{summary.duplicateMemories}</strong>
            </li>
            <li>
              <span>Would delete</span>
              <strong>{lastPreview.impact.wouldDelete.memories}</strong>
            </li>
          </ul>
          {fieldConflicts.length > 0 ? (
            <ul aria-label="Changed memory conflicts" className="conflict-list">
              {fieldConflicts.slice(0, 5).map((conflict) => (
                <li key={conflict.id}>
                  <span>{conflict.id}</span>
                  <strong>{conflict.fields.join(", ")}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <div className="source-result-panel empty">
          <span>No import preview</span>
          <p>Preview an export before restoring a tenant graph.</p>
        </div>
      )}
      {lastImportResult ? (
        <section
          aria-label="Graph import result"
          className="graph-import-result"
        >
          <span>
            Imported {lastImportResult.memoriesImported} memories and{" "}
            {lastImportResult.edgesImported} edges.
          </span>
          <span>
            Skipped {lastImportResult.memoriesSkipped ?? 0} and overwrote{" "}
            {lastImportResult.memoriesOverwritten ?? 0}.
          </span>
          <span>
            Indexed {lastImportResult.activeMemoriesIndexed} memories.
          </span>
        </section>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemoryMeta({ memory }: Readonly<{ memory: Memory }>) {
  return (
    <div className="meta">
      <span className="pill">{memory.type}</span>
      <span className="pill">{memory.status}</span>
      {memory.tags.map((tag) => (
        <span className="pill" key={tag}>
          {tag}
        </span>
      ))}
      {memory.entityIds.map((entityId) => (
        <span className="pill" key={entityId}>
          {entityId}
        </span>
      ))}
    </div>
  );
}

function McpSetup({
  apiUrl,
  connections,
  onRevoke,
}: Readonly<{
  apiUrl: string;
  connections: OAuthConnection[];
  onRevoke: (clientId: string) => Promise<void>;
}>) {
  const baseUrl = cleanBaseUrl(apiUrl);
  const mcpUrl = `${baseUrl}/mcp`;
  const issuerUrl = `${baseUrl}/api/auth`;
  const authServerMetadataUrl = `${baseUrl}/.well-known/oauth-authorization-server/api/auth`;
  const protectedResourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
  const clientConfig = {
    transport: "streamable-http",
    url: mcpUrl,
    authorizationServer: authServerMetadataUrl,
    protectedResource: protectedResourceMetadataUrl,
    scopes: ["openid", "profile", "memory:read", "memory:write"],
  };
  return (
    <div className="stack">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Client setup</p>
          <h2>MCP</h2>
        </div>
      </div>
      <div className="settings-grid">
        <div className="field">
          <Label htmlFor="mcpUrl">Server URL</Label>
          <Input id="mcpUrl" readOnly value={mcpUrl} />
        </div>
        <div className="field">
          <Label htmlFor="issuer">OAuth issuer</Label>
          <Input id="issuer" readOnly value={issuerUrl} />
        </div>
        <div className="field">
          <Label htmlFor="authorizationMetadata">Authorization metadata</Label>
          <Input
            id="authorizationMetadata"
            readOnly
            value={authServerMetadataUrl}
          />
        </div>
        <div className="field">
          <Label htmlFor="resourceMetadata">Protected resource metadata</Label>
          <Input
            id="resourceMetadata"
            readOnly
            value={protectedResourceMetadataUrl}
          />
        </div>
      </div>
      <pre className="context">{JSON.stringify(clientConfig, null, 2)}</pre>
      <div className="panel-title">
        <div>
          <p className="eyebrow">OAuth grants</p>
          <h2>Connections</h2>
        </div>
      </div>
      {connections.length === 0 ? (
        <div className="empty-state compact">
          <h3>No authorized clients</h3>
          <p>
            Authorize an MCP client through OAuth and its grant will appear here
            for revocation.
          </p>
        </div>
      ) : (
        <div className="memory-list">
          {connections.map((connection) => (
            <article className="memory compact" key={connection.clientId}>
              <div className="meta">
                <span className="pill">{connection.name}</span>
                {connection.scopes.map((scope) => (
                  <span className="pill" key={scope}>
                    {scope}
                  </span>
                ))}
              </div>
              <pre className="context">{connection.clientId}</pre>
              <Button
                onClick={() => void onRevoke(connection.clientId)}
                size="sm"
                type="button"
                variant="outline"
              >
                Revoke
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBindingLabel(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatWarningLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSemanticIndexStatus(
  status?: ReadinessSnapshot["semanticIndex"]["status"],
) {
  switch (status) {
    case "current":
      return "Current";
    case "needs_repair":
      return "Needs repair";
    case "unchecked":
      return "Needs check";
    case "unconfigured":
      return "Unconfigured";
    default:
      return "Loading";
  }
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getBrowserProductionDefaultApiUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  return getProductionDefaultApiUrl(window.location);
}

function hasStoredLocalStorageValue(key: string) {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(key) !== null;
}

function useLocalStorage(key: string, initialValue: string) {
  const [value, setValue] = useState(initialValue);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    setValue(window.localStorage.getItem(key) ?? initialValue);
    setHasLoaded(true);
  }, [initialValue, key]);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    window.localStorage.setItem(key, value);
  }, [hasLoaded, key, value]);

  return [value, setValue, hasLoaded] as const;
}

function useHasMounted() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted;
}

function formatError(error: unknown) {
  if (error instanceof OpenMemoryApiError) {
    return `${error.status}: ${error.message}`;
  }

  return error instanceof Error ? error.message : "Unexpected error";
}

async function getSession(apiUrl: string) {
  const response = await fetch(`${cleanBaseUrl(apiUrl)}/api/auth/get-session`, {
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user?: AuthUser } | null;
  return data?.user ?? null;
}

async function authRequest(
  apiUrl: string,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${cleanBaseUrl(apiUrl)}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function cleanBaseUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, "");
}

function parseView(value: unknown): View {
  return typeof value === "string" && value in VIEW_LABELS
    ? (value as View)
    : "recall";
}

function parseMemoryId(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseSearchTextParam(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMemoryTypeParam(value: unknown) {
  return typeof value === "string" && value.trim() && value !== "all"
    ? value
    : undefined;
}

function parseRelationshipParam(value: unknown) {
  return typeof value === "string" && value.trim() && value !== "all"
    ? value
    : undefined;
}

function parseMemorySortParam(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const [columnId, direction] = value.split(".");
  if (
    columnId &&
    MEMORY_SORT_COLUMNS.has(columnId) &&
    (direction === "asc" || direction === "desc")
  ) {
    return `${columnId}.${direction}`;
  }

  return undefined;
}

function parseMemorySort(value: string | undefined): MemoryTableSorting {
  const parsed = parseMemorySortParam(value);
  if (!parsed) {
    return [...DEFAULT_MEMORY_SORT];
  }

  const [columnId, direction] = parsed.split(".");
  return [{ id: columnId, desc: direction === "desc" }];
}

function serializeMemorySort(sorting: MemoryTableSorting) {
  const [firstSort] = sorting;
  if (!firstSort || !MEMORY_SORT_COLUMNS.has(firstSort.id)) {
    return undefined;
  }

  if (firstSort.id === "updatedAt" && firstSort.desc) {
    return undefined;
  }

  return `${firstSort.id}.${firstSort.desc ? "desc" : "asc"}`;
}
