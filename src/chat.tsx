import React, { useEffect, useRef, useState } from "react";
import {
  List,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Icon,
  Color,
  useNavigation,
  Detail,
  LocalStorage,
  LaunchProps,
  Form,
  Clipboard,
} from "@raycast/api";
import {
  ChatMessage,
  streamChat,
  listModels,
  ModelInfo,
  UsageInfo,
} from "./client";

interface Turn {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp?: number;
  modelUsed?: string;
}

const SYSTEM_PROMPT =
  "You are OmniRoute, a helpful AI assistant accessed from Raycast.";

const CONVO_KEY = "omniroute:conversation";
const MODEL_KEY = "omniroute:last-model";
const PROMPT_KEY = "omniroute:system-prompt";
const REACTIONS_KEY = "omniroute:reactions";

export default function ChatCommand(props: LaunchProps) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>("auto");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [systemPrompt, setSystemPrompt] = useState<string>(SYSTEM_PROMPT);
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef("");
  const usageRef = useRef<UsageInfo | null>(null);
  const { push } = useNavigation();

  // Keep ref in sync so send() never has stale closures
  inputRef.current = input;

  // Restore the previous conversation + last-used model + custom system prompt + reactions.
  useEffect(() => {
    (async () => {
      try {
        const stored = await LocalStorage.getItem<string>(CONVO_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Turn[];
          if (Array.isArray(parsed)) setMessages(parsed);
        }
      } catch {
        // ignore corrupt storage
      }
      const savedModel = await LocalStorage.getItem<string>(MODEL_KEY);
      if (savedModel) setModel(savedModel);
      const savedPrompt = await LocalStorage.getItem<string>(PROMPT_KEY);
      if (savedPrompt) setSystemPrompt(savedPrompt);
      const savedReactions = await LocalStorage.getItem<string>(REACTIONS_KEY);
      if (savedReactions) {
        try {
          setReactions(JSON.parse(savedReactions));
        } catch {
          /* ignore */
        }
      }
    })();
  }, []);

  // Load the model catalog for the picker (best-effort; falls back to "auto").
  useEffect(() => {
    (async () => {
      try {
        const m = await listModels();
        if (m.length) setModels(m);
      } catch {
        // non-fatal: picker still offers "auto" + custom entry
      }
    })();
  }, []);

  // If launched with a prompt argument (e.g. via a hotkey), ask immediately.
  useEffect(() => {
    const arg = (props.arguments as { prompt?: string } | undefined)?.prompt;
    if (arg) send(arg);
  }, []);

  async function persist(msgs: Turn[]) {
    const clean = msgs
      .filter((t) => t.content)
      .map(({ role, content }) => ({ role, content }));
    await LocalStorage.setItem(CONVO_KEY, JSON.stringify(clean));
  }

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;

    const history: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    const userTurn: Turn = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const assistantTurn: Turn = {
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userTurn, assistantTurn]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const activeModel = model || "auto";

    usageRef.current = null;

    try {
      let acc = "";
      for await (const partial of streamChat(
        history,
        activeModel,
        controller.signal,
        usageRef,
      )) {
        acc = partial;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: acc,
            streaming: true,
          };
          return next;
        });
      }
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: acc,
          streaming: false,
          modelUsed: activeModel,
        };
        persist(next);
        return next;
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("aborted") || controller.signal.aborted) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            role: "assistant",
            content: (last?.content ?? "") + " ⏹ (stopped)",
            streaming: false,
          };
          persist(next);
          return next;
        });
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "OmniRoute failed",
          message: msg,
        });
        // drop the empty assistant bubble on hard error
        setMessages((prev) =>
          prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev,
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function toggleReaction(idx: number, emoji: string) {
    const next = { ...reactions };
    if (next[idx] === emoji) {
      delete next[idx];
    } else {
      next[idx] = emoji;
    }
    setReactions(next);
    await LocalStorage.setItem(REACTIONS_KEY, JSON.stringify(next));
  }

  async function newConversation() {
    await LocalStorage.removeItem(CONVO_KEY);
    setMessages([]);
  }

  /** Remove the last assistant message and re-send the last user message. */
  function regenerate() {
    if (busy || messages.length < 2) return;
    const lastUserIdx = messages
      .map((m, i) => (m.role === "user" ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    if (lastUserIdx === undefined) return;
    const lastUserMsg = messages[lastUserIdx];
    // Keep up to and including the user message, remove everything after
    const trimmed = messages.slice(0, lastUserIdx + 1);
    setMessages(trimmed);
    setTimeout(() => send(lastUserMsg.content), 0);
  }

  /** Delete a specific message by index. */
  function deleteMessage(idx: number) {
    if (busy) return;
    setMessages((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Replace a user message with a new prompt and re-send. */
  function editUserMessage(idx: number, newPrompt: string) {
    if (busy) return;
    const text = newPrompt.trim();
    if (!text) return;
    // Keep messages up to (but not including) the user message, then re-send
    const trimmed = messages.slice(0, idx);
    setMessages(trimmed);
    setTimeout(() => send(text), 0);
  }

  const smartModels = models.filter((m) => m.id.startsWith("auto/"));
  const otherModels = models.filter((m) => !m.id.startsWith("auto/"));

  return (
    <List
      isLoading={busy}
      searchBarPlaceholder={
        busy
          ? "Generating… (type to queue, ⌘Enter to send)"
          : `Message OmniRoute…  [${model}]`
      }
      onSearchTextChange={(text) => {
        setInput(text);
        // If user presses Enter, Raycast fires onSearchTextChange with the
        // current text. Detect Enter by checking if the text changed via
        // submit (not just a character append). This is a heuristic: if the
        // search text is still the same after a brief moment, treat it as a
        // submit. For simplicity, use the action-based approach below.
      }}
      searchText={input}
      throttle
      searchBarAccessory={
        <List.Dropdown
          tooltip="Select model"
          storeValue
          value={model}
          onChange={(v) => {
            setModel(v);
            LocalStorage.setItem(MODEL_KEY, v);
          }}
        >
          <List.Dropdown.Item title="Auto (router picks)" value="auto" />
          {smartModels.length > 0 && (
            <List.Dropdown.Section title="Smart routers">
              {smartModels.map((m) => (
                <List.Dropdown.Item key={m.id} title={m.id} value={m.id} />
              ))}
            </List.Dropdown.Section>
          )}
          {otherModels.length > 0 && (
            <List.Dropdown.Section title="All models">
              {otherModels.slice(0, 250).map((m) => (
                <List.Dropdown.Item
                  key={m.id}
                  title={m.name ?? m.id}
                  value={m.id}
                />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          {busy ? (
            <Action
              title="Stop"
              icon={Icon.Stop}
              onAction={stop}
              shortcut={{ modifiers: [], key: "enter" }}
            />
          ) : (
            <Action
              title="Send"
              icon={Icon.ArrowUpCircle}
              onAction={() => send(inputRef.current)}
              shortcut={{ modifiers: ["cmd"], key: "enter" }}
            />
          )}
          <Action
            title="New Conversation"
            icon={Icon.Trash}
            onAction={newConversation}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
          />
          <Action
            title="Use Custom Model…"
            icon={Icon.Pencil}
            onAction={() =>
              push(
                <CustomModel
                  current={model}
                  onSubmit={(v) => {
                    setModel(v);
                    LocalStorage.setItem(MODEL_KEY, v);
                  }}
                />,
              )
            }
          />
          <Action
            title="Set System Prompt…"
            icon={Icon.Text}
            onAction={() =>
              push(
                <CustomPrompt
                  current={systemPrompt}
                  onSubmit={(v) => {
                    setSystemPrompt(v);
                    LocalStorage.setItem(PROMPT_KEY, v);
                    showToast({
                      style: Toast.Style.Success,
                      title: "System prompt updated",
                    });
                  }}
                />,
              )
            }
          />
          {systemPrompt !== SYSTEM_PROMPT && (
            <Action
              title="Reset System Prompt"
              icon={Icon.Undo}
              onAction={() => {
                setSystemPrompt(SYSTEM_PROMPT);
                LocalStorage.removeItem(PROMPT_KEY);
                showToast({
                  style: Toast.Style.Success,
                  title: "System prompt reset to default",
                });
              }}
            />
          )}
          <Action
            title="View Last Answer"
            icon={Icon.Eye}
            onAction={() => {
              const last = [...messages]
                .reverse()
                .find((m) => m.role === "assistant" && m.content);
              if (last) push(<DetailView content={last.content} />);
            }}
          />
          <Action
            title="Copy Full Conversation"
            icon={Icon.Clipboard}
            onAction={() => {
              const md = messages
                .map(
                  (m) =>
                    `**${m.role === "user" ? "You" : "OmniRoute"}:**\n${m.content}`,
                )
                .join("\n\n");
              Clipboard.copy(md);
              showToast({
                style: Toast.Style.Success,
                title: "Copied",
                message: "Full conversation copied as markdown.",
              });
            }}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    >
      {messages.length === 0 ? (
        <List.EmptyView
          title="Ask OmniRoute anything"
          description={`Type and press ⌘Enter to send. Multi-turn conversation persists across launches. Model: ${model}`}
        />
      ) : (
        messages.map((m, i) => {
          const reaction = reactions[i];
          const timeStr = m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          // Build subtitle with content preview, model badge, and token usage
          const modelBadge = m.modelUsed ? `[${m.modelUsed}]` : "";
          const usageLabel =
            m.role === "assistant" && i > 0 && usageRef.current
              ? ` (${usageRef.current.total_tokens ?? "?"}t)`
              : "";
          const subtitle = [
            m.content || (m.streaming ? "…" : ""),
            timeStr,
            modelBadge,
            usageLabel,
          ]
            .filter(Boolean)
            .join("  ·  ");
          return (
            <List.Item
              key={i}
              title={`${m.role === "user" ? "You" : "OmniRoute"}${reaction ? `  ${reaction}` : ""}`}
              subtitle={subtitle}
              icon={
                m.role === "user"
                  ? { source: Icon.Person, tintColor: Color.Blue }
                  : { source: Icon.Stars, tintColor: Color.Purple }
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard content={m.content} />
                  <Action
                    title="View"
                    icon={Icon.Eye}
                    onAction={() => push(<DetailView content={m.content} />)}
                  />
                  {m.role === "assistant" && m.content && (
                    <>
                      <Action
                        title="Regenerate"
                        icon={Icon.RotateClockwise}
                        onAction={regenerate}
                      />
                      <Action
                        title={reaction === "👍" ? "👍 (remove)" : "👍 Good"}
                        icon={Icon.ThumbsUp}
                        onAction={() => toggleReaction(i, "👍")}
                      />
                      <Action
                        title={reaction === "👎" ? "👎 (remove)" : "👎 Bad"}
                        icon={Icon.ThumbsDown}
                        onAction={() => toggleReaction(i, "👎")}
                      />
                    </>
                  )}
                  {m.role === "user" && !busy && (
                    <Action
                      title="Edit & Re-send"
                      icon={Icon.Pencil}
                      onAction={() =>
                        push(
                          <EditMessage
                            initial={m.content}
                            onSubmit={(v) => editUserMessage(i, v)}
                          />,
                        )
                      }
                    />
                  )}
                  {!busy && (
                    <Action
                      title="Delete Message"
                      icon={Icon.Trash}
                      onAction={() => deleteMessage(i)}
                    />
                  )}
                </ActionPanel>
              }
            />
          );
        })
      )}
      {/* Always show the compose input as the last item when not empty */}
      {messages.length > 0 && (
        <List.Item
          key="compose"
          title=""
          subtitle=""
          icon={{ source: Icon.QuoteBlock, tintColor: Color.Green }}
          actions={
            <ActionPanel>
              {busy ? (
                <Action
                  title="Stop"
                  icon={Icon.Stop}
                  onAction={stop}
                  shortcut={{ modifiers: [], key: "enter" }}
                />
              ) : (
                <Action
                  title="Send"
                  icon={Icon.ArrowUpCircle}
                  onAction={() => send(inputRef.current)}
                  shortcut={{ modifiers: [], key: "enter" }}
                />
              )}
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function DetailView({ content }: { content: string }) {
  return <Detail markdown={content} />;
}

// Inline model-id prompt rendered as a Raycast Form (pushed onto the nav stack).
function CustomModel({
  current,
  onSubmit,
}: {
  current: string;
  onSubmit: (v: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Use Model"
            onSubmit={(values: { model: string }) => {
              const v = (values.model ?? "").trim();
              if (v) onSubmit(v);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="model"
        title="Model id"
        placeholder="e.g. auto/best-coding or gemini-web/gemini-3.1-pro"
        defaultValue={current}
        autoFocus
      />
    </Form>
  );
}

// Inline system-prompt editor rendered as a Raycast Form (pushed onto the nav stack).
function CustomPrompt({
  current,
  onSubmit,
}: {
  current: string;
  onSubmit: (v: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Prompt"
            onSubmit={(values: { prompt: string }) => {
              const v = (values.prompt ?? "").trim();
              if (v) onSubmit(v);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="System Prompt"
        placeholder="Instructions for the AI…"
        defaultValue={current}
        autoFocus
      />
    </Form>
  );
}

/** Inline form for editing a user message and re-sending. */
function EditMessage({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (v: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send"
            onSubmit={(values: { text: string }) => {
              pop();
              onSubmit(values.text ?? "");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Edit Message"
        defaultValue={initial}
        autoFocus
        enableMarkdown={false}
      />
    </Form>
  );
}
