import React from 'react'
import ReactDOM from 'react-dom/client'
import '@voicechat/ui/styles.css'
import '@voicechat/ui/app.css'
import './recorder.css'
import { Recorder } from './Recorder'
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<React.StrictMode><Recorder /></React.StrictMode>)
