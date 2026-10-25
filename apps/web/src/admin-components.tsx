import type {
  Account,
  AccountDeletionResult,
  OAuthConnection,
} from "@openmemory/client";
import { Badge, Button, Card, Input, Label } from "@openmemory/ui";
import {
  Building2,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

export function AccountStatus({
  sessionUser,
  tenantId,
  usesLocalTenant,
  onSignOut,
}: Readonly<{
  sessionUser: AuthUser | null;
  tenantId: string;
  usesLocalTenant: boolean;
  onSignOut: () => Promise<void>;
}>) {
  return (
    <Card className="sidebar-section">
      <div className="section-label">Account</div>
      <div className="account-summary">
        <UserRound aria-hidden="true" />
        <span>
          <strong>{sessionUser ? sessionUser.email : "Not signed in"}</strong>
          <small>
            {sessionUser
              ? "Session-backed tenant"
              : usesLocalTenant
                ? tenantId
                : "Hosted session required"}
          </small>
        </span>
      </div>
      {sessionUser ? (
        <Button onClick={() => void onSignOut()} size="sm" type="button">
          Sign out
        </Button>
      ) : null}
    </Card>
  );
}

export function AdminWorkspace({
  account,
  apiUrl,
  connections,
  deleteConfirmEmail,
  deleteConfirmTenantId,
  isLoading,
  lastAccountDeletion,
  onDeleteAccount,
  onRevoke,
  onSaveProfile,
  onRenameWorkspace,
  onSignOut,
  profileName,
  sessionUser,
  setApiUrl,
  setDeleteConfirmEmail,
  setDeleteConfirmTenantId,
  setProfileName,
  setTenantId,
  setToken,
  setWorkspaceName,
  tenantId,
  token,
  usesLocalTenant,
  workspaceName,
  teamPanel,
}: Readonly<{
  account: Account | null;
  apiUrl: string;
  connections: OAuthConnection[];
  deleteConfirmEmail: string;
  deleteConfirmTenantId: string;
  isLoading: boolean;
  lastAccountDeletion: AccountDeletionResult | null;
  onDeleteAccount: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRevoke: (clientId: string) => Promise<void>;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRenameWorkspace: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSignOut: () => Promise<void>;
  profileName: string;
  sessionUser: AuthUser | null;
  setApiUrl: (value: string) => void;
  setDeleteConfirmEmail: (value: string) => void;
  setDeleteConfirmTenantId: (value: string) => void;
  setProfileName: (value: string) => void;
  setTenantId: (value: string) => void;
  setToken: (value: string) => void;
  setWorkspaceName: (value: string) => void;
  tenantId: string;
  token: string;
  usesLocalTenant: boolean;
  workspaceName: string;
  teamPanel: ReactNode;
}>) {
  const baseUrl = cleanBaseUrl(apiUrl);
  const canDeleteAccount =
    Boolean(account && sessionUser) &&
    deleteConfirmEmail.trim().toLowerCase() ===
      account?.user.email.trim().toLowerCase() &&
    deleteConfirmTenantId.trim().toLowerCase() ===
      account?.workspace.tenantId.trim().toLowerCase();
  return (
    <div className="admin-grid">
      <section className="admin-card identity-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Identity</p>
            <h2>Account</h2>
          </div>
          <Badge variant={sessionUser ? "default" : "outline"}>
            {sessionUser ? "Signed in" : "Local mode"}
          </Badge>
        </div>
        <div className="status-strip">
          <UserRound aria-hidden="true" />
          <span>
            <strong>{sessionUser ? sessionUser.email : tenantId}</strong>
            <small>
              {sessionUser
                ? sessionUser.id
                : usesLocalTenant
                  ? "Header tenant for local development"
                  : "Sign in to use hosted tenant identity"}
            </small>
          </span>
        </div>
        <div className="stack">
          {sessionUser ? (
            <Button
              disabled={isLoading}
              onClick={() => void onSignOut()}
              type="button"
            >
              Sign out
            </Button>
          ) : (
            <>
              <p>Sign in with a code sent to your invited email address.</p>
              <a href={`${baseUrl}/login`}>Sign in to OpenMemory</a>
            </>
          )}
        </div>
      </section>

      <section className="admin-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>User profile</h2>
          </div>
          <UserRound aria-hidden="true" />
        </div>
        <form className="stack" onSubmit={onSaveProfile}>
          <div className="status-strip">
            <UserRound aria-hidden="true" />
            <span>
              <strong>
                {account?.user.name ?? sessionUser?.name ?? "Local user"}
              </strong>
              <small>
                {account?.user.email ?? sessionUser?.email ?? tenantId}
              </small>
            </span>
          </div>
          <div className="field">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              disabled={!sessionUser}
              id="profile-name"
              onChange={(event) => setProfileName(event.target.value)}
              value={profileName}
            />
          </div>
          <Button
            disabled={isLoading || !sessionUser || !profileName.trim()}
            type="submit"
            variant="outline"
          >
            Save profile
          </Button>
        </form>
      </section>

      <section className="admin-card admin-card-wide">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Personal workspace name</h2>
          </div>
          <Building2 aria-hidden="true" />
        </div>
        <div className="workspace-admin-grid">
          <form className="stack" onSubmit={onRenameWorkspace}>
            <div className="status-strip">
              <UsersRound aria-hidden="true" />
              <span>
                <strong>
                  {account?.workspace.name ??
                    (usesLocalTenant ? "Local workspace" : "Sign in required")}
                </strong>
                <small>
                  {account
                    ? `Tenant ${account.workspace.tenantId}`
                    : usesLocalTenant
                      ? tenantId
                      : "Better Auth session creates your hosted workspace"}
                </small>
              </span>
            </div>
            <div className="settings-grid">
              <div className="field settings-grid-wide">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input
                  disabled={!sessionUser}
                  id="workspace-name"
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  value={workspaceName}
                />
              </div>
            </div>
            <Button
              disabled={isLoading || !sessionUser || !workspaceName.trim()}
              type="submit"
            >
              Save workspace
            </Button>
          </form>
        </div>
      </section>
      {teamPanel}

      <section className="admin-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Tenant routing</p>
            <h2>Runtime</h2>
          </div>
          <ShieldCheck aria-hidden="true" />
        </div>
        <div className="settings-grid">
          <div className="field settings-grid-wide">
            <Label htmlFor="admin-api-url">API URL</Label>
            <Input
              id="admin-api-url"
              onChange={(event) => setApiUrl(event.target.value)}
              value={apiUrl}
            />
          </div>
          <div className="field">
            <Label htmlFor="admin-tenant">Local tenant</Label>
            <Input
              disabled={!usesLocalTenant}
              id="admin-tenant"
              onChange={(event) => setTenantId(event.target.value)}
              value={tenantId}
            />
          </div>
          <div className="field">
            <Label htmlFor="admin-token">Bearer token</Label>
            <Input
              id="admin-token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="Optional"
              type="password"
              value={token}
            />
          </div>
        </div>
        <div className="runtime-list">
          <RuntimeRow
            label="Mode"
            value={usesLocalTenant ? "Local worker" : "Hosted worker"}
          />
          <RuntimeRow label="API" value={baseUrl} />
          <RuntimeRow
            label="Tenant source"
            value={
              usesLocalTenant ? "x-openmemory-user-id" : "Better Auth session"
            }
          />
        </div>
      </section>

      <section className="admin-card admin-card-wide">
        <div className="panel-title">
          <div>
            <p className="eyebrow">OAuth</p>
            <h2>MCP client access</h2>
          </div>
          <KeyRound aria-hidden="true" />
        </div>
        {connections.length === 0 ? (
          <div className="empty-state compact">
            <h3>No authorized clients</h3>
            <p>
              Connect an MCP client through the OAuth flow to manage issued
              grants here.
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
      </section>

      <section className="admin-card admin-card-wide danger-zone">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Danger zone</p>
            <h2>Delete account</h2>
          </div>
          <Trash2 aria-hidden="true" />
        </div>
        <div className="status-strip danger-strip">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>
              {account
                ? `Deletes tenant ${account.workspace.tenantId}`
                : "Hosted session required"}
            </strong>
            <small>
              Removes graph data, Vectorize entries, R2 exports, sessions, OAuth
              grants, workspace rows, and the user record.
            </small>
          </span>
        </div>
        <form className="stack" onSubmit={onDeleteAccount}>
          <div className="settings-grid">
            <div className="field">
              <Label htmlFor="delete-email">Confirm email</Label>
              <Input
                disabled={!account || isLoading}
                id="delete-email"
                onChange={(event) => setDeleteConfirmEmail(event.target.value)}
                placeholder={account?.user.email ?? "you@example.com"}
                type="email"
                value={deleteConfirmEmail}
              />
            </div>
            <div className="field">
              <Label htmlFor="delete-tenant">Confirm tenant id</Label>
              <Input
                disabled={!account || isLoading}
                id="delete-tenant"
                onChange={(event) =>
                  setDeleteConfirmTenantId(event.target.value)
                }
                placeholder={account?.workspace.tenantId ?? "tenant id"}
                value={deleteConfirmTenantId}
              />
            </div>
          </div>
          <div className="row">
            <Button
              disabled={isLoading || !canDeleteAccount}
              type="submit"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
              Delete account
            </Button>
            {lastAccountDeletion ? (
              <span className="muted">
                Deleted {lastAccountDeletion.graph.memoriesDeleted} memories and{" "}
                {lastAccountDeletion.graph.exports.deleted} R2 exports
              </span>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function RuntimeRow({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function cleanBaseUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, "");
}
