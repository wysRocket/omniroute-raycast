import React from "react";
import { useEffect, useState } from "react";
import { List, Icon, Color, ActionPanel, Action } from "@raycast/api";
import {
  detailedHealth,
  DetailedHealth,
  serverHealth,
  ServerHealth,
} from "./client";

export default function StatusCommand() {
  const [health, setHealth] = useState<DetailedHealth | null>(null);
  const [srvHealth, setSrvHealth] = useState<ServerHealth | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [r, s] = await Promise.all([detailedHealth(), serverHealth()]);
    setHealth(r);
    setSrvHealth(s);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const ok = health?.ok;

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder=""
      actions={
        <ActionPanel>
          <Action
            title="Refresh"
            icon={Icon.RotateClockwise}
            onAction={refresh}
          />
        </ActionPanel>
      }
    >
      {health ? (
        <>
          <List.Item
            title="Server"
            subtitle={ok ? "Up" : "Down"}
            icon={
              ok === null
                ? { source: Icon.Circle, tintColor: Color.Yellow }
                : ok
                  ? { source: Icon.CheckCircle, tintColor: Color.Green }
                  : { source: Icon.XmarkCircle, tintColor: Color.Red }
            }
          />
          <List.Item
            title="Status"
            subtitle={health.detail}
            icon={Icon.Message}
          />
          {srvHealth?.version ? (
            <List.Item
              title="Server Version"
              subtitle={srvHealth.version}
              icon={Icon.Info}
            />
          ) : null}
          {srvHealth?.uptime ? (
            <List.Item
              title="Uptime"
              subtitle={srvHealth.uptime}
              icon={Icon.Clock}
            />
          ) : null}
          {health.serverModelCount !== undefined && (
            <List.Item
              title="Available Models"
              subtitle={String(health.serverModelCount)}
              icon={Icon.List}
            />
          )}
          {Object.entries(health.diagnostics).map(([key, val]) => (
            <List.Item
              key={key}
              title={key}
              subtitle={val}
              icon={Icon.Circle}
            />
          ))}
        </>
      ) : (
        <List.Item title="Checking…" icon={Icon.Circle} />
      )}
    </List>
  );
}
