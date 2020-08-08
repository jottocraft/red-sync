const { app, BrowserWindow, autoUpdater, dialog } = require('electron');
const isDev = require('electron-is-dev');
const path = require("path");
const fs = require("fs");

//Prevent app from running on setup
if(require('electron-squirrel-startup')) return;

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

  //Set start menu tile color
  try {
    var sqpath = path.join(__dirname, "..", "..", "..");
    if (fs.existsSync(path.join(sqpath, "VLC Sync (beta).exe"))) {
      fs.copyFile(path.join(__dirname, "tile.png"), path.join(sqpath, "tile.png"), (err) => {
        fs.copyFile(path.join(__dirname, "smallTile.png"), path.join(sqpath, "smallTile.png"), (err) => {
          fs.copyFile(path.join(__dirname, "VLC Sync (beta).VisualElementsManifest.xml"), path.join(sqpath, "VLC Sync (beta).VisualElementsManifest.xml"), (err) => {
            if (err) throw err;
            console.log('start menu tile set');
          });
        });
      });
    }
  } catch(e) {}
}

//Disable media key support
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 600,
    height: 900,
    webPreferences: {
      nodeIntegration: true
    },
    icon: __dirname + "/favicon.ico",
    title: "VLC Sync (beta)",
    autoHideMenuBar: true
  })

  // and load the index.html of the app.
  win.loadFile('index.html')
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.