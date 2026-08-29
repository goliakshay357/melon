import * as RadixDialog from '@radix-ui/react-dialog';
import { THEMES } from '@/theme/themes';
import { useThemeStore } from '@/theme/theme-store';
import { cn } from '@/lib/utils';
import { SkillsManager } from '@/components/skills-manager';

/**
 * Settings dialog. Sections stack vertically — add new ones below Appearance.
 * The theme list is rendered straight from the registry in src/theme/themes.ts.
 */
export function SettingsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);

    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
                <RadixDialog.Content
                    className="fixed left-1/2 top-1/2 z-[1001] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <RadixDialog.Title className="text-sm font-semibold text-card-foreground">
                        Settings
                    </RadixDialog.Title>
                    <RadixDialog.Description className="sr-only">
                        Configure appearance and application preferences.
                    </RadixDialog.Description>

                    {/* Appearance */}
                    <p className="mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Theme
                    </p>
                    <div className="mt-2 space-y-1" role="radiogroup" aria-label="Theme">
                        {THEMES.map((t) => {
                            const active = t.id === themeId;
                            return (
                                <button
                                    key={t.id}
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => setTheme(t.id)}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                                        active
                                            ? 'border-ring bg-primary/10'
                                            : 'border-border hover:bg-secondary',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'size-3 shrink-0 rounded-full border',
                                            active
                                                ? 'border-primary bg-primary'
                                                : 'border-muted-foreground/50',
                                        )}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-card-foreground">
                                            {t.label}
                                        </span>
                                        <span className="block text-[10px] capitalize text-muted-foreground">
                                            {t.appearance}
                                        </span>
                                    </span>
                                    <span className="flex shrink-0 gap-1">
                                        {(
                                            [
                                                '--background',
                                                '--primary',
                                                '--accent',
                                            ] as const
                                        ).map((v) => (
                                            <span
                                                key={v}
                                                className="size-4 rounded-full border border-border"
                                                style={{
                                                    background: `hsl(${t.vars[v]})`,
                                                }}
                                            />
                                        ))}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {/* Skills manager */}
                    <p className="mt-5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Skills
                    </p>
                    <div className="mt-2">
                        <SkillsManager />
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
