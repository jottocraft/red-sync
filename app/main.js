const { app, BrowserWindow, autoUpdater, dialog, ipcMain } = require('electron');
const isDev = require('electron-is-dev');
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

//Prevent app from running on setup
if (require('electron-squirrel-startup')) return;

// Force Single Instance Application
const shouldRun = app.requestSingleInstanceLock();
if (!shouldRun) {
  app.quit();
  return;
}

const server = "https://update.red.jottocraft.com"
const feed = `${server}/update/${process.platform}/${app.getVersion()}`

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
  const dialogOpts = {
    type: 'info',
    buttons: ['Update', 'Install'],
    title: 'Application Update',
    detail: 'A new version has been downloaded. Restart the application to apply the updates.'
  }

  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    autoUpdater.quitAndInstall();
  });
});

autoUpdater.on('error', message => {
  console.error('UPDATE ERROR', message)
});

//Check for updates if in production

if (!isDev) {
  autoUpdater.setFeedURL(feed);
  autoUpdater.checkForUpdates();

  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 600000);

  //Uninstall old version
  var oldVersionMangaer = path.join(__dirname, "..", "..", "..", "..", "vlc-sync", "Update.exe");
  if (fs.existsSync(oldVersionMangaer)) {
    console.log("Found old version. Automatically uninstalling...");
    execFile(oldVersionMangaer, ["--uninstall"], function() {
      try {fs.rmdirSync(path.join(oldVersionMangaer, ".."), { recursive: true });} catch(e) {}
    });
  }

  //Set start menu tile color
  try {
    var sqpath = path.join(__dirname, "..", "..", "..");
    if (fs.existsSync(path.join(sqpath, "Red (beta).exe"))) {
      fs.copyFile(path.join(__dirname, "tile.png"), path.join(sqpath, "tile.png"), (err) => {
        fs.copyFile(path.join(__dirname, "smallTile.png"), path.join(sqpath, "smallTile.png"), (err) => {
          fs.copyFile(path.join(__dirname, "Red (beta).VisualElementsManifest.xml"), path.join(sqpath, "Red (beta).VisualElementsManifest.xml"), (err) => {
            if (err) throw err;
            console.log('start menu tile set');
          });
        });
      });
    }
  } catch (e) { }
}

//Disable media key support
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true
    },
    icon: __dirname + "/favicon.ico",
    title: "Red (beta)",
    autoHideMenuBar: true
  })

  // and load the index.html of the app.
  win.loadFile('index.html')
  win.maximize();

  win.webContents.on('did-finish-load', () => {
    // Protocol handler for win32
    if (process.platform == 'win32') {
      win.webContents.send('deepLinkArgs', process.argv.slice(1))
    }
  })

  win.webContents.on('new-window', function (e, url) {
    e.preventDefault();
    require('electron').shell.openExternal(url);
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('second-instance', (event, argv, cwd) => {
  // Someone tried to run a second instance, we should focus our window.
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();

    if (process.platform == 'win32') {
      win.webContents.send('deepLinkArgs', argv.slice(1));
    }
  }
});

//Handle jottocraft-red URL
app.setAsDefaultProtocolClient('jottocraft-red');

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

//Discord RPC
//Copy Discord GameSDK
if (!isDev) {
  try {
    fs.copyFile(path.join(__dirname, "discord_game_sdk.dll"), path.join(__dirname, "..", "..", "discord_game_sdk.dll"), (err) => {
      if (err) throw err;
      discordGame();
    });
  } catch (e) { }
} else {
  discordGame();
}

function discordGame() {
  const Discord = require('discord-game');
  const isRequireDiscord = false;
  const hasDiscord = Discord.create('749736883096911892', isRequireDiscord);

  ipcMain.on('discord-activity', (event, arg) => {
    if (hasDiscord) {
      try {
        Discord.Activity
          .update(arg)
          .catch(function (e) { console.error("[Discord Rich Presence Error] " + e); });
      } catch (e) { }
    }
  })

  if (hasDiscord) {
    setInterval(function () {
      try { Discord.runCallback(); } catch (e) { }
    }, 1000 / 60)
  }
}