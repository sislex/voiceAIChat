const { app, BrowserWindow } = require('electron')
const path = require('node:path')
app.setPath('userData', process.env.VC_MEASURE_USER_DATA)
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, contextIsolation: true, preload: path.join(__dirname, 'measure-electron-preload.cjs') } })
  // Workstation pointer input must not preload optional screens during the
  // no-intent benchmark. CDP still drives the real, visible renderer.
  window.setIgnoreMouseEvents(true)
  window.showInactive()
  window.loadFile(process.env.VC_MEASURE_HTML)
})
app.on('window-all-closed', () => app.quit())
