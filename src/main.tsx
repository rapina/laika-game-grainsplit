import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

/** Preload Galmuri so canvas text is not cached with a fallback font. */
async function preloadFonts() {
    try {
        await Promise.all([
            document.fonts.load('11px Galmuri11'),
            document.fonts.load('bold 14px Galmuri14'),
        ])
    } catch { /* best effort */ }
}

preloadFonts().finally(() => {
    createRoot(document.getElementById('root')!).render(<App />)
})
