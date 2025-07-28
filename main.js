const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
// const fs = require('fs'); // 不再需要

function createWindow() {
  console.log('NODE_ENV:aaaaa');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

// 新增：暴露 userData 路径
ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

// 新增：选择导出文件夹
ipcMain.handle('select-export-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择导出文件夹',
    properties: ['openDirectory']
  });
  return result;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
}); 