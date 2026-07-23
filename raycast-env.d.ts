/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** OmniRoute Base URL - Where your local OmniRoute server listens. */
  "baseUrl": string,
  /** API Key / CLI Token - OmniRoute CLI token (header x-omniroute-cli-token) or a server API key. The CLI token is what `omniroute chat` uses locally. */
  "apiKey": string,
  /** Default Model - Model id, or 'auto' to let OmniRoute route. Provider/model works too, e.g. gemini-web/gemini-3.5-flash. */
  "defaultModel": string,
  /** Auto-start server when down - When the OmniRoute server is down, the menubar item will attempt to start it automatically. */
  "autoStartServer": boolean,
  /** Auto-copy answer on completion - When enabled, the Ask and Chat commands auto-copy the answer to clipboard on completion. */
  "autoCopyOnCompletion": boolean,
  /** Ask System Prompt - System prompt used by the Ask command (one-shot). Leave blank for default. */
  "askSystemPrompt": string,
  /** Menubar auto-copy answer - When enabled, the menubar quick-chat auto-copies the answer to clipboard on completion. */
  "menubarAutoCopy": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `chat` command */
  export type Chat = ExtensionPreferences & {}
  /** Preferences accessible in the `models` command */
  export type Models = ExtensionPreferences & {}
  /** Preferences accessible in the `status` command */
  export type Status = ExtensionPreferences & {}
  /** Preferences accessible in the `ask` command */
  export type Ask = ExtensionPreferences & {}
  /** Preferences accessible in the `menubar` command */
  export type Menubar = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `chat` command */
  export type Chat = {
  /** Ask OmniRoute anything… */
  "prompt": string
}
  /** Arguments passed to the `models` command */
  export type Models = {}
  /** Arguments passed to the `status` command */
  export type Status = {}
  /** Arguments passed to the `ask` command */
  export type Ask = {
  /** Ask OmniRoute anything… */
  "prompt": string,
  /** Model id (optional, default: auto) */
  "model": string
}
  /** Arguments passed to the `menubar` command */
  export type Menubar = {
  /** Question to ask */
  "query": string
}
}

