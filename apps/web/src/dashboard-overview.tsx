import type { Memory, ReadinessSnapshot } from "@openmemory/client";
import { Activity, Brain, GitBranch, KeyRound } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ActivityPoint,
  type DashboardMetrics,
  type DistributionPoint,
  getActivitySummary,
  getGraphHealthSummary,
  getIndexReadinessSummary,
  getRelationshipReadinessSummary,
  getTypeDistributionSummary,
} from "./dashboard-model";

export function DashboardOverview({
  lifecycleDistribution,
  memories,
  metrics,
  readiness,
  recentActivity,
  typeDistribution,
}: Readonly<{
  lifecycleDistribution: DistributionPoint[];
  memories: Memory[];
  metrics: DashboardMetrics;
  readiness: ReadinessSnapshot | null;
  recentActivity: ActivityPoint[];
  typeDistribution: DistributionPoint[];
}>) {
  const activitySummary = getActivitySummary(recentActivity);
  const graphHealth = getGraphHealthSummary(metrics);
  const indexReadiness = getIndexReadinessSummary(memories, readiness);
  const relationshipReadiness = getRelationshipReadinessSummary(metrics);
  const typeSummary = getTypeDistributionSummary(typeDistribution);

  return (
    <section className="overview-grid" aria-label="Memory overview">
      <div className="metric-tile featured">
        <Activity aria-hidden="true" />
        <span>Active memories</span>
        <strong>{metrics.activeMemories}</strong>
        <small>{metrics.totalMemories} total graph nodes</small>
      </div>
      <div className="metric-tile">
        <GitBranch aria-hidden="true" />
        <span>Edges</span>
        <strong>{metrics.totalEdges}</strong>
        <small>{metrics.relationshipCount} relationship types</small>
      </div>
      <div className="metric-tile">
        <Brain aria-hidden="true" />
        <span>Entities</span>
        <strong>{metrics.entityCount}</strong>
        <small>{metrics.tagCount} tags indexed</small>
      </div>
      <div className="metric-tile">
        <KeyRound aria-hidden="true" />
        <span>MCP clients</span>
        <strong>{metrics.oauthConnections}</strong>
        <small>{metrics.recalledMemories} recalled in context</small>
      </div>
      <div className="chart-panel activity-panel">
        <div className="panel-heading">
          <span>Capture cadence</span>
          <strong>Last 7 days</strong>
        </div>
        <div className="chart-panel-grid">
          <div className="chart-summary">
            <span>Total captures</span>
            <strong>{activitySummary.total}</strong>
            <small>
              {activitySummary.activeDays} active days · peak{" "}
              {activitySummary.peakLabel} ({activitySummary.peakCount})
            </small>
          </div>
          <div
            className="chart-frame"
            role="img"
            aria-label="Memory capture activity"
          >
            <ResponsiveContainer height={150} width="100%">
              <BarChart data={recentActivity} margin={{ left: 0, right: 6 }}>
                <CartesianGrid stroke="#e4e4e7" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
                  formatter={(value) => [value, "Memories"]}
                />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="insight-panel graph-health-panel">
        <div className="panel-heading">
          <span>Graph health</span>
          <strong>{graphHealth.status}</strong>
        </div>
        <ul aria-label="Graph health signals" className="insight-list">
          <li>
            <span>Edge density</span>
            <strong>{graphHealth.edgeDensity}</strong>
          </li>
          <li>
            <span>Signal coverage</span>
            <strong>{graphHealth.signalCoverage}%</strong>
          </li>
          <li>
            <span>Active nodes</span>
            <strong>{metrics.activeMemories}</strong>
          </li>
        </ul>
      </div>
      <div className="chart-panel type-panel">
        <div className="panel-heading">
          <span>Memory mix</span>
          <strong>{typeDistribution.length} types</strong>
        </div>
        <div className="chart-panel-grid">
          <div className="chart-summary">
            <span>Leading type</span>
            <strong>{typeSummary.leadingLabel}</strong>
            <small>
              {typeSummary.leadingCount} of {typeSummary.total} memories ·{" "}
              {typeSummary.leadingShare}%
            </small>
            <ul aria-label="Memory type ranking" className="distribution-list">
              {typeDistribution.slice(0, 4).map((point) => (
                <li className="distribution-row" key={point.label}>
                  <span>{point.label}</span>
                  <div aria-hidden="true">
                    <i
                      style={{
                        inlineSize: `${Math.max(8, point.percent)}%`,
                      }}
                    />
                  </div>
                  <strong>{point.count}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="chart-frame">
            {typeDistribution.length === 0 ? (
              <p className="muted">No typed memories yet.</p>
            ) : (
              <ResponsiveContainer height={150} width="100%">
                <BarChart
                  data={typeDistribution}
                  layout="vertical"
                  margin={{ bottom: 0, left: 10, right: 12, top: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#e4e4e7" />
                  <XAxis allowDecimals={false} axisLine={false} type="number" />
                  <YAxis
                    axisLine={false}
                    dataKey="label"
                    tickLine={false}
                    type="category"
                    width={92}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(15, 118, 110, 0.08)" }}
                    formatter={(value) => [value, "Memories"]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {typeDistribution.map((point, index) => (
                      <Cell
                        fill={index % 2 === 0 ? "#2563eb" : "#0f766e"}
                        key={point.label}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      <div className="insight-panel relationship-health-panel">
        <div className="panel-heading">
          <span>Relationship readiness</span>
          <strong>{relationshipReadiness.status}</strong>
        </div>
        <ul
          aria-label="Relationship readiness signals"
          className="insight-list"
        >
          <li>
            <span>Relationship diversity</span>
            <strong>{relationshipReadiness.relationshipDiversity}%</strong>
          </li>
          <li>
            <span>Types indexed</span>
            <strong>{metrics.relationshipCount}</strong>
          </li>
          <li>
            <span>Total edges</span>
            <strong>{metrics.totalEdges}</strong>
          </li>
        </ul>
      </div>
      <div className="chart-panel lifecycle-panel">
        <div className="panel-heading">
          <span>Memory lifecycle</span>
          <strong>{indexReadiness.currentShare}% current</strong>
        </div>
        <div className="chart-panel-grid">
          <div className="chart-summary">
            <span>Current index</span>
            <strong>{indexReadiness.currentMemories}</strong>
            <small>
              {indexReadiness.staleMemories} stale records ·{" "}
              {indexReadiness.status}
            </small>
            <ul
              aria-label="Memory lifecycle ranking"
              className="distribution-list"
            >
              {lifecycleDistribution.map((point) => (
                <li className="distribution-row" key={point.label}>
                  <span>{point.label}</span>
                  <div aria-hidden="true">
                    <i
                      style={{
                        inlineSize: `${Math.max(8, point.percent)}%`,
                      }}
                    />
                  </div>
                  <strong>{point.count}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="chart-frame"
            role="img"
            aria-label="Memory lifecycle status"
          >
            <ResponsiveContainer height={150} width="100%">
              <BarChart
                data={lifecycleDistribution}
                margin={{ bottom: 0, left: 0, right: 12, top: 4 }}
              >
                <CartesianGrid stroke="#e4e4e7" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(15, 118, 110, 0.08)" }}
                  formatter={(value) => [value, "Memories"]}
                />
                <Bar dataKey="count" radius={[6, 6, 2, 2]}>
                  {lifecycleDistribution.map((point) => (
                    <Cell
                      fill={
                        point.label === "forgotten"
                          ? "#71717a"
                          : point.label === "historical"
                            ? "#d97706"
                            : "#0f766e"
                      }
                      key={point.label}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="insight-panel index-health-panel">
        <div className="panel-heading">
          <span>Index readiness</span>
          <strong>{indexReadiness.status}</strong>
        </div>
        <ul aria-label="Index readiness signals" className="insight-list">
          <li>
            <span>Current share</span>
            <strong>{indexReadiness.currentShare}%</strong>
          </li>
          <li>
            <span>Current records</span>
            <strong>{indexReadiness.currentMemories}</strong>
          </li>
          <li>
            <span>Stale records</span>
            <strong>{indexReadiness.staleMemories}</strong>
          </li>
        </ul>
      </div>
    </section>
  );
}
