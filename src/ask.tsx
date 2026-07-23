import React, { useEffect, useRef, useState } from "react";
import {
  Detail,
  LaunchProps,
  showToast,
  Toast,
  Icon,
  ActionPanel,
  Action,
  Clipboard,
} from "@raycast/api";
import { ChatMessage, streamChat, prefs } from "./client";

const DEFAULT_SYSTEM_PROMPT =
  "You are OmniRoute, a helpful AI assistant accessed from Raycast.";

export default function AskCommand(props: LaunchProps) {
  const arg =
    (props.arguments as { prompt?: string } | undefined)?.prompt ?? "";
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const modelArg = (props.arguments as { model?: string } | undefined)?.model;
  const activeModel = modelArg?.trim() || prefs().defaultModel || "auto";
  const systemPrompt = prefs().askSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  useEffect(() => {
    const prompt = arg.trim();
    if (!prompt) {
      setLoading(false);
      setError("No prompt provided. Pass text as the command argument.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];
      try {
        let acc = "";
        for await (const partial of streamChat(
          history,
          activeModel,
          controller.signal,
        )) {
          acc = partial;
          setText(acc);
        }
        setDone(true);
        if (prefs().autoCopyOnCompletion && acc) {
          await Clipboard.copy(acc);
          await showToast({
            style: Toast.Style.Success,
            title: "Copied",
            message: `Answer from ${activeModel}`,
          });
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (!controller.signal.aborted) {
          setError(msg);
          await showToast({
            style: Toast.Style.Failure,
            title: "OmniRoute failed",
            message: msg,
          });
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    })();

    return () => controller.abort();
  }, []);

  const body =
    error != null
      ? `## ⚠️ Error\n\n${error}`
      : text
        ? `${text}\n\n---\n*Model: ${activeModel}*`
        : loading
          ? "_Generating…_"
          : "_No response_";

  return (
    <Detail
      isLoading={loading}
      markdown={body}
      actions={
        <ActionPanel>
          {loading && (
            <Action
              title="Stop"
              icon={Icon.Stop}
              onAction={() => abortRef.current?.abort()}
              shortcut={{ modifiers: [], key: "enter" }}
            />
          )}
          {text && !error ? (
            <>
              <Action.CopyToClipboard content={text} />
              <Action
                title="Copy to Clipboard"
                icon={Icon.Clipboard}
                onAction={() => Clipboard.copy(text)}
              />
            </>
          ) : null}
          {error && (
            <Action
              title="Retry"
              icon={Icon.RotateClockwise}
              onAction={() => {
                setError(null);
                setText("");
                setLoading(true);
                setDone(false);
                // Re-trigger the effect by forcing a re-mount isn't practical,
                // so we show instructions
                showToast({
                  style: Toast.Style.Animated,
                  title: "Re-run the Ask command to retry",
                });
              }}
            />
          )}
          {done && text && (
            <Action
              title="Copy Answer & Model"
              icon={Icon.Info}
              onAction={() =>
                Clipboard.copy(`${text}\n\n— Model: ${activeModel}`)
              }
            />
          )}
        </ActionPanel>
      }
    />
  );
}
