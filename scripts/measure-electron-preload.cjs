const { contextBridge } = require('electron')
// Match the two startup ports; the production renderer installs its real HTTP/WS bridges.
contextBridge.exposeInMainWorld('remoteClient', { getUrl: async () => process.env.VC_MEASURE_BASE })
contextBridge.exposeInMainWorld('agentAdmin', { getState: async () => ({ status: 'offline' }), onStatus: () => () => {} })
