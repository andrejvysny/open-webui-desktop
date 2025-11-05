// @ts-nocheck

import {
    app,
    shell,
    session,
    clipboard,
    nativeImage,
    desktopCapturer,
    BrowserWindow,
    globalShortcut,
    Notification,
    Menu,
    ipcMain,
    Tray,
} from "electron";
import path, { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";

import {
    getLogFilePath,
    checkUrlAndOpen,
    getConfig,
    getServerLog,
    installPackage,
    installPython,
    isPackageInstalled,
    isPythonInstalled,
    isUvInstalled,
    openUrl,
    resetApp,
    setConfig,
    startServer,
    stopAllServers,
    uninstallPython,
} from "./utils";

import log from "electron-log";
log.transports.file.resolvePathFn = () => getLogFilePath("main");

import icon from "../../resources/icon.png?asset";
import trayIconImage from "../../resources/assets/tray.png?asset";

// Main application logic
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false; // Flag to track if the app is quitting

let CONFIG: object | null = null;
let SERVER_URL: string | null = null;
let SERVER_STATUS: string | null = null;
let SERVER_REACHABLE = false;
let SERVER_PID: number | null = null;

function createWindow(show = true): void {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 700,
        height: 500,
        minWidth: 400,
        minHeight: 400,
        icon: path.join(__dirname, "assets/icon.png"),
        show: false,
        titleBarStyle: process.platform === "win32" ? "default" : "hidden",
        trafficLightPosition: { x: 16, y: 16 },
        autoHideMenuBar: true,
        ...(process.platform === "win32"
            ? {
                  frame: true,
              }
            : {}),
        ...(process.platform === "linux" ? { icon } : {}),
        ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            sandbox: false,
        },
    });
    mainWindow.setIcon(icon);
    
    // Set up session to allow loading from localhost
    const baseAllowedHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        let targetHost: string | null = null;
        try {
            targetHost = new URL(details.url).hostname;
        } catch (error) {
            // Ignore parsing issues and fall back to original headers.
        }

        let serverHost: string | null = null;
        try {
            serverHost = SERVER_URL ? new URL(SERVER_URL).hostname : null;
        } catch (error) {
            serverHost = null;
        }

        const allowListed = targetHost
            ? baseAllowedHosts.has(targetHost) || (!!serverHost && targetHost === serverHost)
            : false;

        if (!allowListed) {
            callback({ responseHeaders: details.responseHeaders });
            return;
        }

        const csp = [
            "default-src 'self' http://127.0.0.1:* http://localhost:*",
            "base-uri 'self'",
            "object-src 'none'",
            "script-src 'self' 'unsafe-inline' blob: http://127.0.0.1:* http://localhost:*",
            "style-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* data:",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https:",
            "connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws://127.0.0.1:* ws://localhost:* wss:",
            "media-src 'self' blob: https:",
            "frame-src 'self'",
            "worker-src 'self' blob:"
        ].join("; ");

        const responseHeaders = { ...(details.responseHeaders ?? {}) };
        for (const headerName of Object.keys(responseHeaders)) {
            if (headerName.toLowerCase() === "content-security-policy") {
                delete responseHeaders[headerName];
            }
        }

        responseHeaders["Content-Security-Policy"] = [csp];

        callback({ responseHeaders });
    });
    
    // Enables navigator.mediaDevices.getUserMedia API. See https://www.electronjs.org/docs/latest/api/desktop-capturer
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer
                .getSources({ types: ["screen"] })
                .then((sources) => {
                    // Grant access to the first screen found.
                    callback({ video: sources[0], audio: "loopback" });
                });
        },
        { useSystemPicker: true }
    );

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    if (show) {
        mainWindow.on("ready-to-show", () => {
            mainWindow?.show();
        });
    }

    // Helper to determine if URL should stay in-app
    const isInternalUrl = (url: string): boolean => {
        try {
            const u = new URL(url);
            const host = u.hostname;
            return (
                host === '127.0.0.1' ||
                host === 'localhost' ||
                host === '0.0.0.0'
            );
        } catch {
            return false;
        }
    };

    // Handle window.open() calls
    mainWindow.webContents.setWindowOpenHandler((details) => {
        log.info(`setWindowOpenHandler: ${details.url}`);
        if (isInternalUrl(details.url)) {
            // Load internal URLs in the same window
            log.info(`Loading internal URL in-app: ${details.url}`);
            mainWindow?.loadURL(details.url);
            return { action: "deny" };
        }
        // External URLs open in system browser
        log.info(`Opening external URL in browser: ${details.url}`);
        openUrl(details.url);
        return { action: "deny" };
    });

    // Handle navigation attempts (e.g., clicking links, form submissions)
    mainWindow.webContents.on('will-navigate', (event, url) => {
        log.info(`will-navigate to: ${url}`);
        if (!isInternalUrl(url)) {
            log.info(`Preventing navigation to external URL: ${url}`);
            event.preventDefault();
            openUrl(url);
        } else {
            log.info(`Allowing navigation to internal URL: ${url}`);
        }
        // Internal URLs are allowed to navigate normally
    });

    // Log successful navigations
    mainWindow.webContents.on('did-navigate', (event, url) => {
        log.info(`did-navigate to: ${url}`);
    });

    // Log navigation failures
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        log.error(`did-fail-load: ${validatedURL} - Error ${errorCode}: ${errorDescription}`);
    });

    globalShortcut.register("Alt+CommandOrControl+O", () => {
        if (SERVER_URL) {
            // Load server URL in the app window instead of opening externally
            mainWindow?.loadURL(SERVER_URL);
            mainWindow?.show();
            if (mainWindow?.isMinimized()) mainWindow?.restore();
            mainWindow?.focus();
        } else {
            mainWindow?.show();

            if (mainWindow?.isMinimized()) mainWindow?.restore();
            mainWindow?.focus();
        }
    });

    const defaultMenu = Menu.getApplicationMenu();
    let menuTemplate = defaultMenu ? defaultMenu.items.map((item) => item) : [];
    menuTemplate.push({
        label: "Action",
        submenu: [
            {
                label: "Uninstall",
                click: () => {
                    uninstallHandler();
                },
            },

            {
                label: "Reset",
                click: async () => {
                    await resetAppHandler();
                },
            },
        ],
    });
    const updatedMenu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(updatedMenu);

    // Create a system tray icon
    const image = nativeImage.createFromPath(trayIconImage);
    tray = new Tray(image.resize({ width: 16, height: 16 }));
    const trayMenu = Menu.buildFromTemplate([
        {
            label: "Show Controls",

            click: () => {
                mainWindow?.show();
            },
        },
        {
            type: "separator",
        },
        {
            label: "Quit Open WebUI",
            accelerator: "CommandOrControl+Q",
            click: async () => {
                await stopServerHandler(); // Stop the server before quitting
                isQuiting = true; // Mark as quitting
                app.quit(); // Quit the application
            },
        },
    ]);

    tray.setToolTip("Open WebUI");
    tray.setContextMenu(trayMenu);

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }

    // Handle the close event
    mainWindow.on("close", (event) => {
        if (!(isQuiting ?? false)) {
            event.preventDefault(); // Prevent the default close behavior
            mainWindow?.hide(); // Hide the window instead of closing it
        }
    });
}

const updateTrayMenu = (status: string, url: string | null) => {
    const trayMenuTemplate = [
        {
            label: "Show Controls",
            click: () => {
                mainWindow?.show();
            },
        },
        {
            type: "separator",
        },
        {
            label: status, // Dynamic status message
            enabled: !!url,
            click: () => {
                if (url) {
                    // Load server URL in the app window instead of external browser
                    mainWindow?.loadURL(url);
                    mainWindow?.show();
                }
            },
        },

        ...(SERVER_STATUS === "started"
            ? [
                  {
                      label: "Copy Server URL",
                      enabled: !!url, // Enable if URL exists
                      click: () => {
                          if (url) {
                              clipboard.writeText(url); // Copy the URL to clipboard
                          }
                      },
                  },
              ]
            : []),

        {
            type: "separator",
        },
        {
            label: "Quit Open WebUI",
            accelerator: "CommandOrControl+Q",
            click: () => {
                isQuiting = true; // Mark as quitting
                app.quit(); // Quit the application
            },
        },
    ];

    const trayMenu = Menu.buildFromTemplate(trayMenuTemplate);
    tray?.setContextMenu(trayMenu);
};

const uninstallHandler = async () => {
    try {
        await uninstallPython();

        // reload the main window to reflect the changes
        if (mainWindow) {
            mainWindow.webContents.send("main:data", {
                type: "reload",
            });
        }
        // Show success notification
        const notification = new Notification({
            title: "Open WebUI",
            body: "Uninstallation successful.",
        });
        notification.show();
    } catch (error) {
        log.error("Uninstallation failed:", error);
        // Show error notification
        const notification = new Notification({
            title: "Open WebUI",
            body: `Uninstallation failed: ${error.message}`,
        });
        notification.show();
    }
};

const startServerHandler = async () => {
    await stopServerHandler();
    SERVER_STATUS = "starting";
    mainWindow?.webContents.send("main:data", {
        type: "status:server",
        data: SERVER_STATUS,
    });

    try {
        CONFIG = await getConfig();

        ({ url: SERVER_URL, pid: SERVER_PID } = await startServer(
            CONFIG?.serveOnLocalNetwork ?? false,
            CONFIG?.port ?? null
        ));

        updateTrayMenu("Open WebUI: Starting...", null);

        log.info("Server started successfully:", SERVER_URL, SERVER_PID);
        SERVER_STATUS = "started";

        mainWindow?.webContents.send("main:data", {
            type: "status:server",
            data: SERVER_STATUS,
        });

        // // Load the server URL in the main window
        // if (SERVER_URL.startsWith("http://0.0.0.0")) {
        //     SERVER_URL = SERVER_URL.replace(
        //         "http://0.0.0.0",
        //         "http://localhost"
        //     );
        // }
        // mainWindow.loadURL(SERVER_URL);

        const urlObj = new URL(SERVER_URL);
        const port = urlObj.port || "8080"; // Fallback to port 8080 if not provided

        checkUrlAndOpen(SERVER_URL, async () => {
            SERVER_REACHABLE = true;

            // Show system notification
            const notification = new Notification({
                title: "Open WebUI",
                body: "Open WebUI is now available in the app",
            });
            notification.show();

            updateTrayMenu(`Open WebUI: ${SERVER_URL}`, SERVER_URL); // Update tray menu with running status
            mainWindow?.webContents.send("main:data", {
                type: "server",
            });
        }, mainWindow); // Pass mainWindow to load URL in-app

        return true; // Indicate success
    } catch (error) {
        log.error("Failed to start server:", error);
        SERVER_STATUS = "failed";
        mainWindow?.webContents.send("main:data", {
            type: "status:server",
            data: SERVER_STATUS,
        });

        mainWindow?.webContents.send(
            "main:log",
            `Failed to start server: ${error}`
        );
        updateTrayMenu("Open WebUI: Failed to Start", null); // Update tray menu with failure status

        return false; // Indicate failure
    }
};

const stopServerHandler = async () => {
    try {
        await stopAllServers();

        if (SERVER_STATUS) {
            // Only when the server was started
            SERVER_STATUS = "stopped";
            updateTrayMenu("Open WebUI: Stopped", null); // Update tray menu with stopped status
        }
        SERVER_REACHABLE = false;
        SERVER_URL = null; // Clear the server URL

        mainWindow?.webContents.send("main:data", {
            type: "status:server",
            data: SERVER_STATUS,
        });

        return true; // Indicate success
    } catch (error) {
        log.error("Failed to stop server:", error);
        return false; // Indicate failure
    }
};

const resetAppHandler = async () => {
    try {
        await stopServerHandler(); // Stop the server if running
        SERVER_STATUS = null;

        // wait a moment to ensure all processes are stopped
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await resetApp(); // Reset the application state

        // Show success notification
        const notification = new Notification({
            title: "Open WebUI",
            body: "Application has been reset successfully.",
        });
        notification.show();
    } catch (error) {
        log.error("Failed to reset application:", error);
        // Show error notification
        const notification = new Notification({
            title: "Open WebUI",
            body: `Failed to reset application: ${error.message}`,
        });
        notification.show();
    }
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit(); // Quit if another instance is already running
} else {
    // Handle second-instance logic
    app.on("second-instance", (event, argv, workingDirectory) => {
        // This event happens if a second instance is launched
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore(); // Restore if minimized
            mainWindow.show(); // Show existing window
            mainWindow.focus(); // Focus the existing window
        }
    });

    app.setAboutPanelOptions({
        applicationName: "Open WebUI",
        iconPath: icon,
        applicationVersion: app.getVersion(),
        version: app.getVersion(),
        website: "https://openwebui.com",
        copyright: `© ${new Date().getFullYear()} Open WebUI (Timothy Jaeryang Baek)`,
    });

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.whenReady().then(async () => {
        CONFIG = await getConfig(); // Load initial config
        log.info("Initial Config:", CONFIG);

        // Set app user model id for windows
        electronApp.setAppUserModelId("com.openwebui.desktop");

        // Default open or close DevTools by F12 in development
        // and ignore CommandOrControl + R in production.
        app.on("browser-window-created", (_, window) => {
            optimizer.watchWindowShortcuts(window);
        });

        // IPC test
        ipcMain.on("ping", () => log.info("pong"));

        // Handle renderer:data IPC calls from Open WebUI
        // This MUST be registered before any window is created
        ipcMain.handle(
            "renderer:data",
            async (event, { type, data }: { type: string; data?: any }) => {
                log.info(`Received renderer:data event of type: ${type}`, data);

                switch (type) {
                    case "app:info":
                        return {
                            name: app.getName(),
                            version: app.getVersion(),
                            isElectron: true,
                        };
                    case "app:data":
                        return {
                            config: CONFIG,
                        };
                    default:
                        log.warn(`Unknown renderer:data event type: ${type}`);
                        return { success: true };
                }
            }
        );

        ipcMain.handle("get:version", async () => {
            return app.getVersion();
        });

        ipcMain.handle("install:python", async (event) => {
            log.info("Installing package...");
            try {
                const res = await installPython();
                if (res) {
                    mainWindow?.webContents.send("main:data", {
                        type: "status:python",
                        data: true,
                    });

                    return true;
                }

                return false;
            } catch (error) {
                mainWindow?.webContents.send("main:data", {
                    type: "status:python",
                    data: false,
                });

                mainWindow?.webContents.send("main:data", {
                    type: "notification",
                    data: {
                        type: "error",
                        message: error?.message ?? "Something went wrong :/",
                    },
                });

                return false;
            }
        });

        ipcMain.handle("install:package", async (event) => {
            log.info("Installing package...");
            try {
                const res = await installPackage("open-webui");
                if (res) {
                    mainWindow?.webContents.send("main:data", {
                        type: "status:package",
                        data: true,
                    });
                }
            } catch (error) {
                mainWindow?.webContents.send("main:data", {
                    type: "status:package",
                    data: false,
                });
            }
        });

        ipcMain.handle("status:python", async (event) => {
            return (await isPythonInstalled()) && (await isUvInstalled());
        });

        ipcMain.handle("status:package", async (event) => {
            const packageStatus = await isPackageInstalled("open-webui");

            log.info("Package Status:", packageStatus);
            return packageStatus;
        });

        ipcMain.handle("server:start", async (event) => {
            return await startServerHandler();
        });

        ipcMain.handle("server:stop", async (event) => {
            return await stopServerHandler();
        });

        ipcMain.handle("server:restart", async (event) => {
            return await startServerHandler();
        });

        ipcMain.handle("server:logs", async (event) => {
            return SERVER_PID ? await getServerLog(SERVER_PID) : [];
        });

        ipcMain.handle("server:info", async (event) => {
            return {
                url: SERVER_URL,
                status: SERVER_STATUS,
                pid: SERVER_PID,
                reachable: SERVER_REACHABLE,
            };
        });

        ipcMain.handle("status:server", async (event) => {
            return SERVER_STATUS;
        });

        ipcMain.handle("app:info", async (event) => {
            return {
                version: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
            };
        });

        ipcMain.handle("app:reset", async (event) => {
            return await resetAppHandler();
        });

        ipcMain.handle("get:config", async (event) => {
            return await getConfig();
        });

        ipcMain.handle("set:config", async (event, config) => {
            return await setConfig(config);
        });

        ipcMain.handle("open:browser", async (event, { url }) => {
            if (!url) {
                throw new Error("No URL provided to open in browser.");
            }
            log.info("Opening URL in browser:", url);
            if (url.startsWith("http://0.0.0.0")) {
                url = url.replace("http://0.0.0.0", "http://localhost");
            }

            await openUrl(url);
        });

        ipcMain.handle("notification", async (event, { title, body }) => {
            log.info("Received notification:", title, body);
            const notification = new Notification({
                title: title,
                body: body,
            });
            notification.show();
        });

        (async () => {
            if (isPackageInstalled("open-webui")) {
                if (CONFIG?.autoUpdate ?? true) {
                    try {
                        log.info("Checking for updates...");
                        updateTrayMenu(
                            "Open WebUI: Checking for updates...",
                            null
                        );
                        await installPackage("open-webui");
                    } catch (error) {
                        log.error("Failed to update package:", error);
                    }
                }

                startServerHandler();
                createWindow(false);
            } else {
                createWindow();
            }
        })();

        app.on("activate", function () {
            // On macOS it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("before-quit", async () => {
        isQuiting = true; // Mark as quitting
        await stopServerHandler(); // Stop the server before quitting
        globalShortcut.unregisterAll(); // Unregister all shortcuts
        mainWindow = null; // Clear the main window reference
        tray?.destroy(); // Destroy the tray icon
        tray = null; // Clear the tray reference
    });
}
