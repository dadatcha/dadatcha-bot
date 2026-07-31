import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import { getApiBase } from '@/lib/api-url';

import App from './App';

import './index.css';

// Point the generated API client to the correct server URL.
// On Replit this is the same-origin path; on Render it's VITE_API_URL.
setBaseUrl(getApiBase());

createRoot(document.getElementById('root')!).render(<App />);
