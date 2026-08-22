import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '@/canvas/canvas';
import '@xyflow/react/dist/style.css';
import '@/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ReactFlowProvider>
            <Canvas />
        </ReactFlowProvider>
    </React.StrictMode>
);
