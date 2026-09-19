import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { DialogHost } from '@/components/dialogs';
import { Canvas } from '@/canvas/canvas';
import { refreshModels } from '@/lib/models';
import { initTheme } from '@/theme/theme-store';
import { initDeveloper } from '@/settings/developer-store';
import '@xyflow/react/dist/style.css';
import 'streamdown/styles.css';
import '@/globals.css';

// Apply the persisted theme to :root before the first render (no FOUC).
initTheme();
initDeveloper();

// Auto-refresh the model catalog on app open. force=false: the server reloads
// models.json immediately but only revalidates provider catalogs over the
// network when the cached copy is stale (>4h). Pickers refetch when it lands
// via the models-updated event.
void refreshModels(false);


class Boundary extends React.Component<
    { children: React.ReactNode },
    { error: Error | null }
> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 40, color: '#f85149', fontFamily: 'monospace' }}>
                    <h2>melon crashed — this is the bug, not you:</h2>
                    <pre>{this.state.error.stack}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Boundary>
            <ReactFlowProvider>
                <DialogHost />
            <Canvas />
        </ReactFlowProvider>
            </Boundary>
    </React.StrictMode>
);
