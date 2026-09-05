import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { PromptComposer, type ComposerPermission } from '@/components/prompt-composer';
import { pickFolder } from '@/lib/pick-folder';
import { useCanvasStore } from '@/store/canvas-store';

export function EmptyCanvasHero({
    position,
    hydrated,
    serverOffline,
}: {
    position: { x: number; y: number };
    hydrated: boolean;
    serverOffline: boolean;
}) {
    const folder = useCanvasStore((state) => state.folder);
    const sidebarCollapsed = useCanvasStore((state) => state.sidebarCollapsed);
    const openFolder = useCanvasStore((state) => state.openFolder);
    const startConversation = useCanvasStore((state) => state.startConversation);
    const [draft, setDraft] = useState('');
    const [model, setModel] = useState('');
    const [skills, setSkills] = useState<string[]>([]);
    const [permission, setPermission] = useState<ComposerPermission>('full');
    const [thinkingLevel, setThinkingLevel] = useState<string | undefined>(undefined);
    const [pickingFolder, setPickingFolder] = useState(false);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        let active = true;
        fetch('/settings')
            .then((response) => response.json())
            .then((data: { settings?: { lastModel?: string } }) => {
                if (active && data.settings?.lastModel) setModel(data.settings.lastModel);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const chooseFolder = async () => {
        setPickingFolder(true);
        try {
            const selected = await pickFolder();
            if (selected) await openFolder(selected);
        } finally {
            setPickingFolder(false);
        }
    };

    const submit = async () => {
        if (starting || !folder || !model || !draft.trim()) return;
        setStarting(true);
        const sent = await startConversation(draft, position, {
            model,
            skills,
            permission,
            thinkingLevel,
        });
        if (!sent && useCanvasStore.getState().cards.length === 0) setStarting(false);
    };

    const waiting = !hydrated || serverOffline;
    const helper = !hydrated
        ? 'Starting Melon…'
        : serverOffline
          ? 'Melon is reconnecting to its local server…'
          : !folder
            ? 'Choose a folder so Melon knows where to work.'
            : !model
              ? 'Choose a provider and model before sending.'
              : 'Enter to send · Shift+Enter for a new line';

    return (
        <div
            className="pointer-events-none absolute inset-y-0 right-0 z-[5] transition-[left] duration-200"
            style={{ left: sidebarCollapsed ? 48 : 260 }}
        >
            {/* Quiet theme wash — replaces dotted canvas on the empty home. */}
            <div className="melon-home-wash absolute inset-0" aria-hidden />

            <div className="absolute inset-0 flex items-center justify-center px-6">
                <div className="pointer-events-auto w-full max-w-2xl -translate-y-8">
                    <div className="mb-5 text-center">
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                            Into the unknown
                        </p>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                            What do you want to explore?
                        </h1>
                    </div>

                    <button
                        disabled={waiting || pickingFolder || starting}
                        onClick={chooseFolder}
                        className="mx-auto mb-2.5 flex max-w-full items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-3 py-2 text-xs backdrop-blur-sm transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                        title={folder ?? 'Choose a working folder'}
                    >
                        {pickingFolder ? (
                            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                        ) : (
                            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {pickingFolder ? (
                            <span className="text-muted-foreground">Opening Finder…</span>
                        ) : folder ? (
                            <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate font-medium text-foreground">
                                    {folder.split('/').filter(Boolean).pop() ?? folder}
                                </span>
                                <span className="truncate text-muted-foreground">{folder}</span>
                            </span>
                        ) : (
                            <span className="text-muted-foreground">Choose a folder</span>
                        )}
                    </button>

                    <PromptComposer
                        value={draft}
                        onChange={setDraft}
                        onSubmit={submit}
                        model={model}
                        onModelChange={setModel}
                        skills={skills}
                        onSkillsChange={setSkills}
                        permission={permission}
                        onPermissionChange={setPermission}
                        thinkingLevel={thinkingLevel}
                        onThinkingChange={setThinkingLevel}
                        disabled={waiting || starting}
                        submitDisabled={!folder || !model}
                        autoFocus={hydrated && !serverOffline}
                        placeholder="Ask Melon to understand, build, or investigate something…"
                        size="hero"
                        className="hero-composer-glow bg-card/90 backdrop-blur-sm"
                    />
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">{helper}</p>
                </div>
            </div>
        </div>
    );
}
