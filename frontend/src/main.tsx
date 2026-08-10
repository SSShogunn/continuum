import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        localization={{ signIn: { start: { title: 'Sign in to Continuum' } } }}
      >
        <App />
      </ClerkProvider>
    </BrowserRouter>
  </StrictMode>,
)
