import React from 'react'
import ReactDOM from 'react-dom/client'
import OverlayWindow from './OverlayWindow'
import { startThemeSync } from '../theme'
import '../../styles/base.css'
import './overlay.css'

startThemeSync()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OverlayWindow />
  </React.StrictMode>
)
