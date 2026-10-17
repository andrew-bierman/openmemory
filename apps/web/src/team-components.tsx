import type {
  createOpenMemoryClient,
  Memory,
  SharedMemoryPage,
  TeamInvitation,
  TeamMember,
  TeamWorkspace,
} from "@openmemory/client";
import { Button, Input, Label, Select } from "@openmemory/ui";
import { useCallback, useEffect, useRef, useState } from "react";

type Api = ReturnType<typeof createOpenMemoryClient>;
const emptyPage: SharedMemoryPage = { items: [], ranking: "page-local" };
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Team request failed. Refresh and try again.";

export function TeamPanel({
  api,
  userId,
  memories,
}: {
  api: Api;
  userId: string;
  memories: Memory[];
}) {
  const [teams, setTeams] = useState<TeamWorkspace[]>([]);
  const [selected, setSelected] = useState("");
  const [invitationId, setInvitationId] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    setError("");
    try {
      const result = await api.listWorkspaces();
      if (request !== epoch.current) return;
      setTeams(result);
      setSelected((previous) =>
        result.some((team) => team.id === previous)
          ? previous
          : (result[0]?.id ?? ""),
      );
    } catch (error) {
      if (request === epoch.current) {
        setTeams([]);
        setError(message(error));
      }
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      ++epoch.current;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const team = teams.find((item) => item.id === selected);
  return (
    <section className="admin-card admin-card-wide" aria-label="Team sharing">
      <h2>Teams and shared memories</h2>
      <p>
        Your personal memories stay private. Selecting a team changes only this
        shared view.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <div className="field">
          <Label htmlFor="team-selector">Team</Label>
          <Select
            id="team-selector"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a team</option>
            {teams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.role}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" onClick={() => void refresh()}>
          Refresh teams
        </Button>
      </div>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api.acceptTeamInvitation(invitationId.trim(), token.trim());
            setToken("");
            setInvitationId("");
            await refresh();
          } catch (error) {
            setError(message(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Accept an invitation</h3>
        <p>
          Sign in as the invited person and enter the ID and secret delivered by
          your inviter.
        </p>
        <Label htmlFor="accept-invitation">Invitation ID</Label>
        <Input
          id="accept-invitation"
          value={invitationId}
          onChange={(event) => setInvitationId(event.target.value)}
          autoComplete="off"
        />
        <Label htmlFor="accept-token">Invitation secret</Label>
        <Input
          id="accept-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <Button
          disabled={busy || !invitationId.trim() || !token.trim()}
          type="submit"
        >
          Accept invitation
        </Button>
      </form>
      {team && (
        <TeamDetails
          key={`${team.id}:${team.memberId}:${team.role}`}
          api={api}
          team={team}
          userId={userId}
          memories={memories}
          onMembershipChange={refresh}
        />
      )}
    </section>
  );
}

function TeamDetails({
  api,
  team,
  userId,
  memories,
  onMembershipChange,
}: {
  api: Api;
  team: TeamWorkspace;
  userId: string;
  memories: Memory[];
  onMembershipChange: () => Promise<void>;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [page, setPage] = useState(emptyPage);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [invitation, setInvitation] = useState<TeamInvitation | null>(null);
  const [memoryId, setMemoryId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const intent = useRef<{ memoryId: string; requestId: string } | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const eligible = memories.filter(
    (memory) => memory.status === "active" && memory.isLatest,
  );
  const selectedMemory = eligible.find((memory) => memory.id === memoryId);
  const refresh = useCallback(
    async (q = "", cursor?: string) => {
      const request = ++epoch.current;
      setPage(emptyPage);
      setMembers([]);
      const [nextMembers, result] = await Promise.all([
        api.listTeamMembers(team.id),
        q
          ? api.searchSharedMemories(team.id, { q, cursor })
          : api.listSharedMemories(team.id, { cursor }),
      ]);
      if (!mounted.current || request !== epoch.current) return;
      setMembers(nextMembers);
      setPage(result);
      setActiveQuery(q);
    },
    [api, team.id],
  );
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      if (mounted.current) {
        ++epoch.current;
        setPage(emptyPage);
        setMembers([]);
        setInvitation(null);
        setError(message(error));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error) => {
      if (mounted.current) setError(message(error));
    });
    return () => {
      mounted.current = false;
      ++epoch.current;
    };
  }, [refresh]);
  useEffect(() => {
    // Keep an invitation in this membership's view while rechecking access,
    // but hide shared results immediately until fresh authorization returns.
    const onFocus = () => {
      void refresh(activeQuery).catch((error) => {
        if (!mounted.current) return;
        setInvitation(null);
        setPage(emptyPage);
        setMembers([]);
        setError(message(error));
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeQuery, refresh]);
  return (
    <div className="stack">
      <h3>{team.name}</h3>
      <p>Your role: {team.role}. Shared memories are read-only.</p>
      {error && <p role="alert">{error}</p>}
      <Button
        type="button"
        disabled={busy}
        onClick={() => void run(() => refresh(activeQuery))}
      >
        Refresh shared memories
      </Button>
      <h3>Members</h3>
      <div className="member-list">
        {members.map((member) => (
          <article className="member-row" key={member.id}>
            <div>
              <strong>
                {member.name ||
                  member.email ||
                  member.userId ||
                  "Pending invitation"}
              </strong>
              <small>
                {member.email} · {member.role} · {member.status}
              </small>
            </div>
            {team.role === "owner" &&
              member.role !== "owner" &&
              member.status === "active" && (
                <Select
                  aria-label={`Role for ${member.email || member.userId}`}
                  disabled={busy}
                  value={member.role}
                  onChange={(event) => {
                    const next =
                      event.target.value === "admin" ? "admin" : "member";
                    void run(async () => {
                      await api.setTeamMemberRole(team.id, member.id, next);
                      await refresh(activeQuery);
                    });
                  }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              )}
            {member.role !== "owner" &&
              (team.role === "owner" ||
                (team.role === "admin" && member.role === "member")) && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.removeTeamMember(team.id, member.id);
                      await refresh(activeQuery);
                    })
                  }
                >
                  Remove {member.email || member.name || "member"}
                </Button>
              )}
          </article>
        ))}
      </div>
      {team.role !== "member" && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setInvitation(null);
              const next = await api.inviteTeamMember(team.id, {
                email: email.trim(),
                role,
              });
              if (mounted.current) {
                setInvitation(next);
                setEmail("");
              }
              await refresh(activeQuery);
            });
          }}
        >
          <h3>Invite a teammate</h3>
          <Label htmlFor="team-member-email">Member email</Label>
          <Input
            id="team-member-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {team.role === "owner" && (
            <>
              <Label htmlFor="team-member-role">Invitation role</Label>
              <Select
                id="team-member-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value === "admin" ? "admin" : "member")
                }
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            </>
          )}
          <Button type="submit" disabled={busy || !email.trim()}>
            Create invitation
          </Button>
        </form>
      )}
      {invitation && (
        <section className="stack" aria-label="New invitation">
          <p>
            Copy these now and deliver privately to the invited person. No email
            was sent. The secret is shown only in this view. Leaving this team
            view or reloading the page clears the secret.
          </p>
          <Label htmlFor="new-invitation-id">New invitation ID</Label>
          <Input
            id="new-invitation-id"
            readOnly
            value={invitation.invitationId}
          />
          <Label htmlFor="new-invitation-secret">New invitation secret</Label>
          <Input id="new-invitation-secret" readOnly value={invitation.token} />
          <p>Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
          <div className="row">
            <Button type="button" onClick={() => setInvitation(null)}>
              Dismiss secret
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.revokeTeamInvitation(
                    team.id,
                    invitation.invitationId,
                  );
                  setInvitation(null);
                  await refresh(activeQuery);
                })
              }
            >
              Revoke invitation
            </Button>
          </div>
        </section>
      )}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedMemory) return;
          void run(async () => {
            if (!intent.current || intent.current.memoryId !== memoryId)
              intent.current = { memoryId, requestId: crypto.randomUUID() };
            await api.shareMemory(team.id, intent.current);
            intent.current = null;
            setMemoryId("");
            await refresh(activeQuery);
          });
        }}
      >
        <h3>Share one of your memories</h3>
        <p>
          Owner: you ({userId}). This shares the selected version, content, type
          and tags with all current and future accepted members of {team.name}.
          New versions stay private. Revocation stops future access but cannot
          retract copies already received.
        </p>
        <Label htmlFor="share-memory">Your active memory version</Label>
        <Select
          id="share-memory"
          value={memoryId}
          onChange={(event) => {
            setMemoryId(event.target.value);
            intent.current = null;
          }}
          disabled={busy}
        >
          <option value="">Choose a memory to share</option>
          {eligible.map((memory) => (
            <option key={memory.id} value={memory.id}>
              {memory.content.slice(0, 80)} · {memory.id}
            </option>
          ))}
        </Select>
        {selectedMemory && (
          <div>
            <p>Selected version: {selectedMemory.id}</p>
            <p>{selectedMemory.content}</p>
            <p>
              {selectedMemory.type} · {selectedMemory.tags.join(", ")}
            </p>
          </div>
        )}
        <Button type="submit" disabled={busy || !selectedMemory}>
          Share selected version read-only
        </Button>
      </form>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => refresh(query.trim()));
        }}
      >
        <div className="field">
          <Label htmlFor="shared-search">Search shared memories</Label>
          <Input
            id="shared-search"
            value={query}
            maxLength={500}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          Search shared
        </Button>
      </form>
      <p>
        Results cover this page of authorized shares. Continue to the next page
        to search more.
      </p>
      <section className="memory-list" aria-label="Shared memory results">
        {page.items.map((memory) => (
          <article className="memory compact" key={memory.shareId}>
            <p>{memory.content}</p>
            <small>
              Owner {memory.ownerUserId} · Selected version {memory.memoryId} ·
              Read-only
            </small>
            <p>
              {memory.type} · {memory.tags.join(", ")}
            </p>
            {memory.ownerUserId === userId && (
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setPage(emptyPage);
                    await api.revokeSharedMemory(team.id, memory.shareId);
                    await refresh(activeQuery);
                  })
                }
              >
                Revoke share
              </Button>
            )}
          </article>
        ))}
        {page.items.length === 0 && <p>No shared memories on this page.</p>}
      </section>
      {page.nextCursor && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => refresh(activeQuery, page.nextCursor))}
        >
          Next shared page
        </Button>
      )}
      {team.role !== "owner" ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.removeTeamMember(team.id, team.memberId);
              await onMembershipChange();
            })
          }
        >
          Leave team
        </Button>
      ) : (
        <form
          className="stack danger-zone"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.deleteWorkspace(team.id, confirmation);
              await onMembershipChange();
            });
          }}
        >
          <h3>Delete team</h3>
          <p>
            Removes this team, its memberships and shares. Users and their
            personal memories remain. This is separate from deleting your user
            account.
          </p>
          <Label htmlFor="delete-team-name">Confirm team name</Label>
          <Input
            id="delete-team-name"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || confirmation !== team.name}
          >
            Delete team
          </Button>
        </form>
      )}
    </div>
  );
}
