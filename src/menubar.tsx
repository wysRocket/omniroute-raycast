import React, { useEffect, useState } from "react";
import {
  MenuBarExtra,
  Color,
  ActionPanel,
  Action,
  LaunchProps,
  Clipboard,
  showToast,
  Toast,
  Detail,
  Form,
  useNavigation,
  Icon,
  open,
  launchCommand,
  LaunchType,
  LocalStorage,
} from "@raycast/api";
import {
  ChatMessage,
  streamChat,
  healthCheck,
  prefs,
  listModels,
  ModelInfo,
  startServer,
} from "./client";

const SYSTEM_PROMPT =
  "You are OmniRoute, a helpful AI assistant accessed from the Raycast menu bar.";

// Use the extension's bundled icon (assets/omniroute.png) for the menu-bar.
const ICON = "omniroute.png";

const LAST_ANSWER_KEY = "omniroute:menubar:last-answer";
const LAST_MODEL_KEY = "omniroute:menubar:last-model";

export default function MenuBarCommand(props: LaunchProps) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [serverDetail, setServerDetail] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const { push } = useNavigation();

  // Poll server health on mount (and every 30s) so the menu-bar icon reflects
  // whether OmniRoute is actually running.
  //
  // NOTE: Raycast has no API to *hide* a menu-bar command at runtime — the item
  // is always visible when the command is enabled in Raycast preferences. So
  // "only when the server is started" is approximated by showing a clear
  // down-state with a one-click "Open Dashboard / Start Server" action. Users
  // who want the item fully gone when the server is down can simply disable
  // the menu-bar command in Raycast → Preferences → Extensions → OmniRoute.
  useEffect(() => {
    const check = async () => {
      const r = await healthCheck();
      setServerUp(r.ok);
      setServerDetail(r.detail);

      // Auto-start server if preference is enabled and server is down.
      if (!r.ok && prefs().autoStartServer) {
        await showToast({
          style: Toast.Style.Animated,
          title: "Starting OmniRoute server…",
          message:
            "Run `omniroute serve --daemon` in Terminal if it doesn't come up.",
        });
        await startServer();
      }
    };
    check();
    const intervalId = setInterval(check, 30000);
    return () => clearInterval(intervalId);
  }, []);

  // Load the model catalog for the picker (best-effort).
  useEffect(() => {
    (async () => {
      try {
        const m = await listModels();
        if (m.length) setModels(m);
      } catch {
        // non-fatal
      }
      // Restore last-used model
      const saved = await LocalStorage.getItem<string>(LAST_MODEL_KEY);
      if (saved) setSelectedModel(saved);
    })();
  }, []);

  // Restore last answer from LocalStorage on mount.
  useEffect(() => {
    (async () => {
      const saved = await LocalStorage.getItem<string>(LAST_ANSWER_KEY);
      if (saved) setAnswer(saved);
    })();
  }, []);

  async function ask(initial: string) {
    if (busy) return;
    const prompt = initial.trim();
    if (!prompt) return;

    setBusy(true);
    setAnswer("");
    try {
      const history: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];
      let acc = "";
      for await (const partial of streamChat(history, selectedModel)) {
        acc = partial;
        setAnswer(acc);
      }
      // Persist answer for next menu open.
      await LocalStorage.setItem(LAST_ANSWER_KEY, acc);
      push(<Detail markdown={acc || "_No response_"} />);
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "OmniRoute failed",
        message: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  // If launched with a query argument (e.g. via a hotkey), ask immediately.
  useEffect(() => {
    const arg = (props.arguments as { query?: string } | undefined)?.query;
    if (arg) ask(arg);
  }, []);

  const down = serverUp === false;
  const base = prefs().baseUrl.replace(/\/+$/, "");

  // Smart router models (auto/*) for the picker.
  const smartModels = models.filter((m) => m.id.startsWith("auto/"));

  return (
    <MenuBarExtra
      icon={{ source: ICON, tintColor: down ? Color.Red : Color.PrimaryText }}
      isLoading={busy}
    >
      {down ? (
        <>
          <MenuBarExtra.Item
            title="Server not running"
            subtitle={serverDetail}
            icon={{ source: Icon.Xmark, tintColor: Color.Red }}
          />
          <MenuBarExtra.Item
            title="Start Server (omniroute serve --daemon)"
            icon={Icon.Plus}
            onAction={async () => {
              await showToast({
                style: Toast.Style.Animated,
                title: "Starting OmniRoute",
                message:
                  "Run `omniroute serve --daemon` in Terminal, then reopen this menu.",
              });
              await startServer();
            }}
          />
          <MenuBarExtra.Item
            title="Open Dashboard"
            icon={Icon.Globe}
            onAction={async () => {
              await open(`${base}`);
            }}
          />
        </>
      ) : null}

      {answer && !down ? (
        <MenuBarExtra.Section title="Last Answer">
          <MenuBarExtra.Item
            title={answer.length > 80 ? answer.slice(0, 77) + "…" : answer}
            subtitle={`via ${selectedModel}`}
            onAction={() => push(<Detail markdown={answer ?? ""} />)}
          />
          <MenuBarExtra.Item
            title="Clear Answer"
            icon={Icon.Xmark}
            onAction={() => {
              setAnswer(null);
              LocalStorage.removeItem(LAST_ANSWER_KEY);
            }}
          />
        </MenuBarExtra.Section>
      ) : null}

      {!down && (
        <MenuBarExtra.Item
          title={busy ? "Generating…" : "New Question"}
          icon={Icon.Bubble}
          onAction={() =>
            push(
              <QuickAsk
                onSubmit={ask}
                models={smartModels}
                currentModel={selectedModel}
                onModelChange={(v) => {
                  setSelectedModel(v);
                  LocalStorage.setItem(LAST_MODEL_KEY, v);
                }}
              />,
            )
          }
        />
      )}

      {!down && (
        <MenuBarExtra.Item
          title={`Model: ${selectedModel}`}
          icon={Icon.Cog}
          onAction={() =>
            push(
              <QuickModelSwitch
                models={smartModels}
                currentModel={selectedModel}
                onModelChange={(v) => {
                  setSelectedModel(v);
                  LocalStorage.setItem(LAST_MODEL_KEY, v);
                }}
              />,
            )
          }
        />
      )}

      {!down && answer ? (
        <MenuBarExtra.Item
          title="Copy Answer"
          icon={Icon.Clipboard}
          onAction={() => Clipboard.copy(answer ?? "")}
        />
      ) : null}

      {!down && (
        <MenuBarExtra.Item
          title="Open Chat Window"
          icon={Icon.Sidebar}
          onAction={async () => {
            await launchCommand({
              name: "chat",
              type: LaunchType.UserInitiated,
            });
          }}
        />
      )}
    </MenuBarExtra>
  );
}

// Inline text prompt rendered as a Raycast Form (pushed onto the nav stack).
// Includes an optional model picker dropdown.
function QuickAsk({
  onSubmit,
  models,
  currentModel,
  onModelChange,
}: {
  onSubmit: (v: string) => void;
  models: ModelInfo[];
  currentModel: string;
  onModelChange: (v: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Ask"
            onSubmit={(values: { prompt: string }) => {
              pop();
              onSubmit(values.prompt ?? "");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="prompt"
        title="Question"
        placeholder="Ask OmniRoute…"
        autoFocus
      />
      <Form.Dropdown
        id="model"
        title="Model"
        value={currentModel}
        onChange={onModelChange}
      >
        <Form.Dropdown.Item title="Auto (router picks)" value="auto" />
        {models.length > 0 && (
          <Form.Dropdown.Section title="Smart routers">
            {models.map((m) => (
              <Form.Dropdown.Item key={m.id} title={m.id} value={m.id} />
            ))}
          </Form.Dropdown.Section>
        )}
      </Form.Dropdown>
    </Form>
  );
}

// Inline model-picker form (no prompt, just model selection).
function QuickModelSwitch({
  models,
  currentModel,
  onModelChange,
}: {
  models: ModelInfo[];
  currentModel: string;
  onModelChange: (v: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Apply"
            onSubmit={(values: { model: string }) => {
              pop();
              onModelChange(values.model ?? "auto");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="model"
        title="Model"
        value={currentModel}
        onChange={onModelChange}
      >
        <Form.Dropdown.Item title="Auto (router picks)" value="auto" />
        {models.length > 0 && (
          <Form.Dropdown.Section title="Smart routers">
            {models.map((m) => (
              <Form.Dropdown.Item key={m.id} title={m.id} value={m.id} />
            ))}
          </Form.Dropdown.Section>
        )}
      </Form.Dropdown>
    </Form>
  );
}
