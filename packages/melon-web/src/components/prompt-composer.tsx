import { useCallback, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { ProviderPicker } from '@/components/provider-picker';
import { SkillsPicker } from '@/components/skills-picker';
import { cn } from '@/lib/utils';

export type ComposerPermission = 'full' | 'readonly';

export function PromptComposer({
    value,
    onChange,
    onSubmit,
    model,
    onModelChange,
    skills,
    onSkillsChange,
    permission,
    onPermissionChange,
    sending = false,
    onStop,
    disabled = false,
    submitDisabled = false,
    autoFocus = false,
    placeholder = 'Ask anything…  (Enter to send, Shift+Enter for newline)',
    className,
    size = 'card',
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    model: string;
    onModelChange: (model: string) => void;
    skills: string[];
    onSkillsChange: (skills: string[]) => void;
    permission: ComposerPermission;
    onPermissionChange: (permission: ComposerPermission) => void;
    sending?: boolean;
    onStop?: () => void;
    disabled?: boolean;
    submitDisabled?: boolean;
    autoFocus?: boolean;
    placeholder?: string;
    className?: string;
    /** `hero` = taller empty-canvas inbox; `card` = compact card footer. */
    size?: 'card' | 'hero';
}) {
    const hero = size === 'hero';
    const maxHeight = hero ? 220 : 120;
    const [openPicker, setOpenPicker] = useState<'model' | 'provider' | 'skills' | null>(null);
    const growTextarea = useCallback(
        (el: HTMLTextAreaElement | null) => {
            if (!el) return;
            el.style.height = 'auto';
            const min = hero ? 112 : 0;
            el.style.height = `${Math.min(Math.max(el.scrollHeight, min), maxHeight)}px`;
        },
        [hero, maxHeight],
    );
    const canSubmit = !disabled && !submitDisabled && value.trim().length > 0;

    return (
        <div
            className={cn(
                'rounded-xl border border-input bg-background shadow-sm focus-within:border-ring',
                hero && 'relative border-transparent shadow-none focus-within:border-transparent',
                className,
            )}
        >
            <textarea
                autoFocus={autoFocus}
                rows={hero ? 4 : 1}
                value={value}
                ref={growTextarea}
                disabled={disabled}
                onChange={(e) => {
                    onChange(e.target.value);
                    growTextarea(e.target);
                }}
                onKeyDown={(e) => {
                    // Keep canvas layout undo/redo from seeing composer keys, but
                    // never preventDefault on Mod-Z/Y — browser owns text undo/redo.
                    e.stopPropagation();
                    const key = e.key.toLowerCase();
                    if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (canSubmit) onSubmit();
                    }
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder={placeholder}
                className={cn(
                    'nodrag nowheel block w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
                    hero
                        ? 'min-h-[112px] max-h-[220px] px-4 pt-4 pb-2 text-sm leading-relaxed'
                        : 'max-h-[120px] px-3 pt-2.5 text-xs leading-relaxed',
                )}
            />
            <div
                className={cn(
                    'flex items-center gap-1',
                    hero ? 'px-3 pb-3 pt-1' : 'px-2 pb-1.5 pt-1',
                )}
            >
                <SkillsPicker
                    value={skills}
                    onChange={onSkillsChange}
                    open={openPicker === 'skills'}
                    onOpenChange={(open) => setOpenPicker(open ? 'skills' : null)}
                />
                <ProviderPicker
                    model={model}
                    onChange={onModelChange}
                    open={openPicker === 'provider'}
                    onOpenChange={(open) => setOpenPicker(open ? 'provider' : null)}
                />
                <ModelPicker
                    value={model}
                    onChange={onModelChange}
                    open={openPicker === 'model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'model' : null)}
                />
                <select
                    className="cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground"
                    title="Workspace permissions"
                    value={permission}
                    onChange={(e) => onPermissionChange(e.target.value as ComposerPermission)}
                    onClick={(e) => e.stopPropagation()}
                >
                    <option value="full">full access</option>
                    <option value="readonly">read-only</option>
                </select>
                <button
                    disabled={!sending && !canSubmit}
                    className={cn(
                        'ml-auto flex size-7 items-center justify-center rounded-full transition-colors',
                        sending
                            ? 'bg-foreground text-background hover:bg-foreground/80'
                            : canSubmit
                              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                              : 'cursor-not-allowed bg-secondary text-muted-foreground',
                    )}
                    title={sending ? 'Stop' : 'Send'}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (sending) onStop?.();
                        else if (canSubmit) onSubmit();
                    }}
                >
                    {sending ? (
                        <Square className="size-3" fill="currentColor" />
                    ) : (
                        <ArrowUp className="size-4" />
                    )}
                </button>
            </div>
        </div>
    );
}
