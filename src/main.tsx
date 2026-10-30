// main.tsx - the app's ignition: find <div id="root"> in index.html and
// start the React app (App.tsx) inside it. Everything else hangs off App.
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
