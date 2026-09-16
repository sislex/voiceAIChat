const { app, BrowserWindow } = require('electron')
const path = require('node:path')
app.setPath('userData', process.env.VC_MEASURE_USER_DATA)
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: true,
    webPreferences: { sandbox: false, contextIsolation: true, preload: path.join(__dirname, 'measure-electron-preload.cjs') } })
  window.loadFile(process.env.VC_MEASURE_HTML)
})
app.on('window-all-closed', () => app.quit())
