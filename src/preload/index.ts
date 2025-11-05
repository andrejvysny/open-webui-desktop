import { ipcRenderer, contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

type Subscriber<T> = (value: T) => void;

const createWritableFallback = <T>(initialValue: T) => {
    let value = initialValue;
    const subscribers = new Set<Subscriber<T>>();

    const notify = () => {
        subscribers.forEach((subscriber) => {
            try {
                subscriber(value);
            } catch (error) {
                console.error("appData subscriber failure", error);
            }
        });
    };

    return {
        set(newValue: T) {
            value = newValue;
            notify();
        },
        update(updater: (current: T) => T) {
            try {
                value = updater(value);
                notify();
            } catch (error) {
                console.error("appData update failure", error);
            }
        },
        subscribe(run: Subscriber<T>) {
            subscribers.add(run);
            try {
                run(value);
            } catch (error) {
                console.error("appData initial subscription failure", error);
            }

            return () => {
                subscribers.delete(run);
            };
        },
        get current() {
            return value;
        },
    };
};

const appDataStore = createWritableFallback<any>(null);

const exposeAppDataStore = () => {
    if (process.contextIsolated) {
        try {
            contextBridge.exposeInMainWorld("appData", appDataStore);
        } catch (error) {
            // Ignore if the front-end already defines its own binding.
        }
    } else {
        // @ts-ignore fallback assignment when context isolation is disabled
        if (typeof window.appData === "undefined") {
            // @ts-ignore
            window.appData = appDataStore;
        }
    }
};

exposeAppDataStore();

const isLocalSource = () => {
    // Check if the execution environment is local
    const origin = window.location.origin;

    // Allow local sources: file protocol, localhost, or 0.0.0.0
    return (
        origin.startsWith("file://") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("0.0.0.0")
    );
};

window.addEventListener("DOMContentLoaded", () => {
    // Listen for messages from the main process
    ipcRenderer.on("main:data", (event, data) => {
        // Forward the message to the renderer using window.postMessage
        window.postMessage(
            {
                ...data,
                type: `electron:${data.type}`,
            },
            window.location.origin
        );
    });
});

// Custom APIs for renderer
const api = {
    onLog: (callback: (message: string) => void) => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        ipcRenderer.on("main:log", (_, message: string) => callback(message));
    },

    send: async ({ type, data }: { type: string; data?: any }) => {
        const response = await ipcRenderer.invoke("renderer:data", { type, data });

        if (type === "app:data" && typeof response !== "undefined") {
            appDataStore.set(response);
        }

        return response;
    },

    openInBrowser: async (url: string) => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        await ipcRenderer.invoke("open:browser", { url });
    },

    getAppInfo: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("app:info");
    },

    getAppData: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        const response = await ipcRenderer.invoke("renderer:data", { type: "app:data" });
        if (typeof response !== "undefined") {
            appDataStore.set(response);
        }

        return response;
    },

    getVersion: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("get:version");
    },

    getConfig: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("get:config");
    },

    setConfig: async (config: Record<string, any>) => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("set:config", config);
    },

    installPython: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("install:python");
    },

    installPackage: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("install:package");
    },

    getPythonStatus: async () => {
        return await ipcRenderer.invoke("status:python");
    },

    getPackageStatus: async () => {
        return await ipcRenderer.invoke("status:package");
    },

    getServerStatus: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("status:server");
    },

    getServerInfo: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("server:info");
    },

    resetApp: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("app:reset");
    },

    startServer: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("server:start");
    },

    stopServer: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("server:stop");
    },

    restartServer: async () => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("server:restart");
    },

    getServerUrl: async () => {
        return await ipcRenderer.invoke("server:url");
    },

    notification: async (title: string, body: string) => {
        if (!isLocalSource()) {
            throw new Error(
                "Access restricted: This operation is only allowed in a local environment."
            );
        }

        return await ipcRenderer.invoke("notification", { title, body });
    },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", electronAPI);
        contextBridge.exposeInMainWorld("electronAPI", api);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore (define in dts)
    window.electronAPI = api;
}
