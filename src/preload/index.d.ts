import { ElectronAPI } from "@electron-toolkit/preload";

interface RendererBridgeAPI {
    onLog(callback: (message: string) => void): void;
    send<T = unknown>(payload: { type: string; data?: unknown }): Promise<T>;
    openInBrowser(url: string): Promise<void>;
    getAppInfo(): Promise<{ name?: string; version?: string; isElectron?: boolean }>;
    getAppData<T = unknown>(): Promise<T>;
    getVersion(): Promise<string>;
    getConfig<T = Record<string, unknown>>(): Promise<T>;
    setConfig(config: Record<string, unknown>): Promise<boolean>;
    installPython(): Promise<boolean>;
    installPackage(): Promise<boolean>;
    getPythonStatus(): Promise<boolean>;
    getPackageStatus(): Promise<boolean>;
    getServerStatus(): Promise<string | null>;
    getServerInfo(): Promise<{
        url: string | null;
        status: string | null;
        pid: number | null;
        reachable: boolean;
    }>;
    resetApp(): Promise<boolean>;
    startServer(): Promise<boolean>;
    stopServer(): Promise<boolean>;
    restartServer(): Promise<boolean>;
    getServerUrl(): Promise<string | null>;
    notification(title: string, body: string): Promise<void>;
}

declare global {
    interface Window {
        electron: ElectronAPI;
        electronAPI: RendererBridgeAPI;
        appData: {
            set(value: unknown): void;
            update(updater: (value: unknown) => unknown): void;
            subscribe(run: (value: unknown) => void): () => void;
            readonly current: unknown;
        };
    }
}
