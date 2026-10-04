import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {PhoneCockpit} from './components/PhoneCockpit.tsx';
import './index.css';

const isPhone = new URLSearchParams(location.search).get('view') === 'phone';
createRoot(document.getElementById('root')!).render(isPhone ? <PhoneCockpit /> : <App />);
