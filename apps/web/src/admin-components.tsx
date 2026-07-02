import type { OAuthConnection } from "@openmemory/client";
import { Badge, Button, Card, Input, Label } from "@openmemory/ui";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import type { FormEvent } from "react";

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
  apiUrl,
  connections,
  email,
  isLoading,
  name,
  onRevoke,
  onSignIn,
  onSignOut,
  onSignUp,
  password,
  sessionUser,
  setApiUrl,
  setEmail,
  setName,
  setPassword,
  setTenantId,
  setToken,
  tenantId,
  token,
  usesLocalTenant,
}: Readonly<{
  apiUrl: string;
  connections: OAuthConnection[];
  email: string;
  isLoading: boolean;
  name: string;
  onRevoke: (clientId: string) => Promise<void>;
  onSignIn: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSignUp: () => Promise<void>;
  password: string;
  sessionUser: AuthUser | null;
  setApiUrl: (value: string) => void;
  setEmail: (value: string) => void;
  setName: (value: string) => void;
  setPassword: (value: string) => void;
  setTenantId: (value: string) => void;
  setToken: (value: string) => void;
  tenantId: string;
  token: string;
  usesLocalTenant: boolean;
}>) {
  const baseUrl = cleanBaseUrl(apiUrl);
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
        <form className="stack" onSubmit={onSignIn}>
          <div className="settings-grid">
            <div className="field">
              <Label htmlFor="admin-name">Name</Label>
              <Input
                id="admin-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </div>
            <div className="field">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </div>
            <div className="field settings-grid-wide">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
          </div>
          <div className="row">
            <Button disabled={isLoading || !email || !password} type="submit">
              Sign in
            </Button>
            <Button
              disabled={isLoading || !email || !password}
              onClick={() => void onSignUp()}
              type="button"
              variant="outline"
            >
              Create account
            </Button>
            {sessionUser ? (
              <Button
                disabled={isLoading}
                onClick={() => void onSignOut()}
                type="button"
                variant="outline"
              >
                Sign out
              </Button>
            ) : null}
          </div>
        </form>
      </section>

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
