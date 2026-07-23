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

  useEffect(() => {
    const check = async () => {
      const r = await healthCheck();
      setServerUp(r.ok);
      setServerDetail(r.detail);
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

  useEffect(() => {
    (async () => {
      try {
        const m = await listModels();
        if (m.length) setModels(m);
      } catch {
        // non-fatal
      }
      const saved = await LocalStorage.getItem<string>(LAST_MODEL_KEY);
      if (saved) setSelectedModel(saved);
    })();
  }, []);

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

    // Push a Detail view immediately so the user sees streaming
    push(
      <StreamingDetail
        model={selectedModel}
        onDone={(finalText) => {
          setAnswer(finalText);
          LocalStorage.setItem(LAST_ANSWER_KEY, finalText);
          if (prefs().menubarAutoCopy && finalText) {
            Clipboard.copy(finalText);
          }
        }}
      />,
    );

    try {
      const history: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];
      let acc = "";
      for await (const partial of streamChat(history, selectedModel)) {
        acc = partial;
      }
      LocalStorage.setItem(LAST_ANSWER_KEY, acc);
      if (prefs().menubarAutoCopy && acc) {
        await Clipboard.copy(acc);
      }
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

  function cycleModel(direction: 1 | -1) {
    const smartModels = models.filter((m) => m.id.startsWith("auto/"));
    if (smartModels.length === 0) return;
    const idx = smartModels.findIndex((m) => m.id === selectedModel);
    const next =
      direction === 1
        ? (idx + 1) % smartModels.length
        : (idx - 1 + smartModels.length) % smartModels.length;
    const nextId = smartModels[next].id;
    setSelectedModel(nextId);
    LocalStorage.setItem(LAST_MODEL_KEY, nextId);
  }

  // If launched with a query argument, ask immediately.
  useEffect(() => {
    const arg = (props.arguments as { query?: string } | undefined)?.query;
    if (arg) ask(arg);
  }, []);

  const down = serverUp === false;
  const base = prefs().baseUrl.replace(/\/+$/, "");
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
            title="Copy Answer"
            icon={Icon.Clipboard}
            onAction={() => Clipboard.copy(answer ?? "")}
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
        <MenuBarExtra.Section title={`Model: ${selectedModel}`}>
          <MenuBarExtra.Item
            title="Switch Model…"
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
          <MenuBarExtra.Item
            title="Previous Model"
            icon={Icon.ChevronUp}
            onAction={() => cycleModel(-1)}
          />
          <MenuBarExtra.Item
            title="Next Model"
            icon={Icon.ChevronDown}
            onAction={() => cycleModel(1)}
          />
        </MenuBarExtra.Section>
      )}

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

/** Detail view that shows streaming content. The parent passes onDone
 * which gets called when the streaming finishes (via a different mechanism).
 * Here we render the persisted answer after the stream completes via the
 * parent's setAnswer flow.
 */
function StreamingDetail({
  model,
  onDone,
}: {
  model: string;
  onDone: (text: string) => void;
}) {
  const [markdown, setMarkdown] = useState("_Waiting for response…_");
  const { pop } = useNavigation();

  // Poll for the answer to appear in LocalStorage (written by ask())
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        const stored = await LocalStorage.getItem<string>(LAST_ANSWER_KEY);
        if (stored) {
          setMarkdown(stored + `\n\n---\n*Model: ${model}*`);
          if (!cancelled) {
            onDone(stored);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Close" icon={Icon.Xmark} onAction={pop} />
        </ActionPanel>
      }
    />
  );
}

// --- Form components (unchanged) ---

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
