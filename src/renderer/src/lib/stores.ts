import { writable } from "svelte/store";

// Shared Svelte stores modeled after the upstream Open WebUI renderer state.
export const appInfo = writable(null);
export const appData = writable(null);

export const info = writable(null);
export const config = writable(null);
export const settings = writable(null);
export const theme = writable("system");

export const user = writable(null);
export const socket = writable(null);

export const WEBUI_NAME = writable("Open WebUI");
export const mobile = writable(false);

export const chatId = writable(null);
export const chats = writable([]);
export const currentChatPage = writable(1);
export const tags = writable([]);
export const temporaryChatEnabled = writable(false);

export const isLastActiveTab = writable(true);
export const isApp = writable(false);

export const toolServers = writable([]);
export const playingNotificationSound = writable(false);
