import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

type Deps = {
  create: (win: BrowserWindow | null) => void;
  close: (win: BrowserWindow | null) => void;
  restart: (win: BrowserWindow | null) => void;
  open: (win: BrowserWindow | null) => void;
  settings: (win: BrowserWindow | null) => void;
  recent: (dir: string) => void;
  dirs: () => string[];
  trigger: (win: BrowserWindow | null, id: string) => void;
};

export function createMenu(deps: Deps) {
  const focused = () => BrowserWindow.getFocusedWindow();
  const recent = deps.dirs().map((dir) => ({
    label: dir,
    click: () => deps.recent(dir),
  }));

  const view: MenuItemConstructorOptions[] = [
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Developer Tools",
          accelerator: "Alt+Cmd+I",
          click: () =>
            BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
        },
      ],
    },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "Symbolic",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings...",
                accelerator: "Cmd+,",
                click: () => deps.settings(focused()),
              },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => deps.create(focused()),
        },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: () => deps.open(focused()),
        },
        {
          label: "Open Recent",
          submenu:
            recent.length > 0
              ? recent
              : [{ label: "No Recent Folders", enabled: false }],
        },
        { type: "separator" as const },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => deps.settings(focused()),
        },
        { type: "separator" as const },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click: () => deps.close(focused()),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Copy",
          accelerator: "CmdOrCtrl+C",
          click: () => deps.trigger(focused(), "copy"),
        },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          click: () => deps.trigger(focused(), "paste"),
        },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: () => deps.trigger(focused(), "select_all"),
        },
      ],
    },
    {
      label: "Session",
      submenu: [
        {
          label: "Restart Session",
          accelerator: "Shift+CmdOrCtrl+R",
          click: () => deps.restart(focused()),
        },
      ],
    },
    ...(process.platform === "darwin"
      ? [
          {
            label: "Window",
            submenu: [
              { role: "minimize" as const },
              { role: "zoom" as const },
              { type: "separator" as const },
              { role: "front" as const },
            ],
          },
        ]
      : []),
    ...view,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
