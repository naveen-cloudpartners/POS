import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/app.css'
import './styles/ui.css'
import './styles/workspace.css'
import './styles/muster-type.css'
import App from './App.tsx'
import './styles/responsive.css'
import MobileAccessGate from './components/mobile/MobileAccessGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileAccessGate>
      <App />
    </MobileAccessGate>
  </StrictMode>,
)
