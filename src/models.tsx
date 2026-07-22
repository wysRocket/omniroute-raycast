import React, { useEffect, useState } from "react";
import { List, showToast, Toast, ActionPanel, Action } from "@raycast/api";
import { listModels, ModelInfo } from "./client";

export default function ModelsCommand() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      try {
        const m = await listModels();
        setModels(m);
        if (m.length === 0) {
          await showToast({
            style: Toast.Style.Animated,
            title: "No models returned",
          });
        }
      } catch (e) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not load models",
          message: (e as Error).message,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derive distinct provider prefixes from model ids (e.g. "gemini-web" from "gemini-web/gemini-3.1-pro")
  const providers = new Set<string>();
  for (const m of models) {
    const parts = m.id.split("/");
    if (parts.length > 1) providers.add(parts[0]);
  }
  const providersSorted = Array.from(providers).sort();

  const filtered =
    filter === "all"
      ? models
      : filter === "auto"
        ? models.filter((m) => m.id.startsWith("auto/"))
        : models.filter((m) => m.id.startsWith(filter + "/"));

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Filter models…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by provider"
          value={filter}
          onChange={setFilter}
        >
          <List.Dropdown.Item title="All models" value="all" />
          <List.Dropdown.Item title="Smart routers (auto/*)" value="auto" />
          <List.Dropdown.Section title="Providers">
            {providersSorted.map((p) => (
              <List.Dropdown.Item key={p} title={p} value={p} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {filtered.map((m) => (
        <List.Item
          key={m.id}
          title={m.name ?? m.id}
          subtitle={m.id}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard content={m.id} title="Copy Model ID" />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
