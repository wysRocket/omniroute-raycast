import React, { useEffect, useState } from "react";
import {
  List,
  showToast,
  Toast,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
} from "@raycast/api";
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

  const providers = new Map<string, number>();
  for (const m of models) {
    const parts = m.id.split("/");
    const prefix = parts.length > 1 ? parts[0] : "(other)";
    providers.set(prefix, (providers.get(prefix) ?? 0) + 1);
  }
  const providersSorted = Array.from(providers.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

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
          <List.Dropdown.Item
            title={`All models (${models.length})`}
            value="all"
          />
          <List.Dropdown.Item
            title={`Smart routers (${models.filter((m) => m.id.startsWith("auto/")).length})`}
            value="auto"
          />
          <List.Dropdown.Section title="Providers">
            {providersSorted.map(([prefix, count]) => (
              <List.Dropdown.Item
                key={prefix}
                title={`${prefix} (${count})`}
                value={prefix}
              />
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
              <Action
                title="Set as Default Model"
                icon={Icon.Star}
                onAction={() => {
                  Clipboard.copy(
                    `Set defaultModel to ${m.id} in Raycast → Extensions → OmniRoute → Default Model`,
                  );
                  showToast({
                    style: Toast.Style.Success,
                    title: "Model ID copied",
                    message:
                      "Paste it into the Default Model preference field.",
                  });
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
