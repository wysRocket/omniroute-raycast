import React from "react";
import { useEffect, useState } from "react";
import { List, Icon, Color } from "@raycast/api";
import { detailedHealth, DetailedHealth } from "./client";

export default function StatusCommand() {
  const [health, setHealth] = useState<DetailedHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await detailedHealth();
      setHealth(r);
      setLoading(false);
    })();
  }, []);

  const ok = health?.ok;

  return (
    <List isLoading={loading} searchBarPlaceholder="">
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
