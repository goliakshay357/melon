import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanvasStore } from '@/store/canvas-store';
import { normalizeProvider, type ProviderInfo } from '@/lib/providers';
import {
	buildModelSections,
	normalizeModel,
	type ModelInfo,
	type ModelSection,
} from '@/lib/models';

/**
 * One picker for provider + model, Supernova-style: search, Favorites, Recents,
 * then every provider's models. Selecting a model selects its provider too,
 * because the value is the `provider/id` label.
 *
 * Favorites persist server-side in settings.json next to recentModels, so they
 * survive an Electron/webview storage reset.
 */
export function ModelPicker({
	value,
	onChange,
	open,
	onOpenChange,
}: {
	value: string;
	onChange: (model: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	const [query, setQuery] = useState('');
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [catalogError, setCatalogError] = useState('');
	const [recents, setRecents] = useState<string[]>([]);
	const [favorites, setFavorites] = useState<string[]>([]);
	// `null` = provider list unavailable; fall back to showing every model rather
	// than hiding the picker. A Set = only these providers may appear.
	const [connectedProviders, setConnectedProviders] = useState<Set<string> | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	const loadModels = () => {
		fetch('/models')
			.then((r) => r.json())
			.then((d) => {
				const raw = Array.isArray(d.models) ? (d.models as Array<Record<string, unknown>>) : [];
				setModels(raw.map(normalizeModel).filter((m): m is ModelInfo => m !== null));
				if (typeof d.error === 'string' && d.error) setCatalogError(d.error);
			})
			.catch((e) =>
				setCatalogError(e instanceof Error ? e.message : 'Could not load models'),
			);
	};

	const loadSettings = () => {
		fetch('/settings')
			.then((r) => r.json())
			.then((d) => {
				setRecents(Array.isArray(d.settings?.recentModels) ? d.settings.recentModels : []);
				setFavorites(Array.isArray(d.settings?.favoriteModels) ? d.settings.favoriteModels : []);
			})
			.catch(() => {});
	};

	const loadConnectedProviders = () => {
		fetch('/auth/providers')
			.then((r) => r.json())
			.then((d) => {
				const list = Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
				const ids = list
					.map(normalizeProvider)
					.filter((p): p is ProviderInfo => p !== null && p.connected)
					.map((p) => p.id);
				setConnectedProviders(new Set(ids));
			})
			.catch(() => setConnectedProviders(null));
	};

	useEffect(() => {
		loadModels();
		loadSettings();
		loadConnectedProviders();
	}, []);

	// Refetch whenever the menu opens: a provider connected in Settings while this
	// composer stayed mounted must show up without a reload.
	useEffect(() => {
		if (!open) return;
		loadModels();
		loadSettings();
		loadConnectedProviders();
	}, [open]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			const t = e.target as Element;
			if (ref.current && !ref.current.contains(t) && !t.closest?.('[data-melon-picker-root]'))
				onOpenChangeRef.current(false);
		};
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onOpenChangeRef.current(false);
		};
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onEsc);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onEsc);
		};
	}, []);

	const toggleFavorite = (label: string) => {
		setFavorites((prev) => {
			const next = prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label];
			void fetch('/settings', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ favoriteModels: next }),
			}).catch(() => {});
			return next;
		});
	};

	const select = (model: string) => {
		onChange(model);
		onOpenChange(false);
	};

	const q = query.trim();
	const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

	// Only models from connected providers are offered. Nothing connected yet →
	// empty list → the "Connect provider" call to action.
	const availableModels = useMemo(
		() => (connectedProviders ? models.filter((m) => connectedProviders.has(m.provider)) : models),
		[models, connectedProviders],
	);

	const sections = useMemo<ModelSection[]>(
		() => buildModelSections({ models: availableModels, favorites, recents, query: q }),
		[q, availableModels, favorites, recents],
	);

	const selected = availableModels.find((m) => m.label === value);
	const noModels = availableModels.length === 0;
	const triggerLabel = noModels ? 'Connect provider' : (selected?.name ?? (value || 'Select model'));

	return (
		<div ref={ref} data-melon-picker-root className="relative">
			<button
				type="button"
				className={cn(
					'flex max-w-[190px] cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] outline-none transition-colors',
					noModels
						? 'bg-primary/10 text-primary hover:bg-primary/15'
						: 'bg-secondary text-muted-foreground hover:text-foreground',
				)}
				title={noModels ? 'No models — connect a provider' : `Model: ${value}`}
				onClick={(e) => {
					e.stopPropagation();
					onOpenChange(!open);
					setQuery('');
				}}
			>
				<span className="truncate">{triggerLabel}</span>
				<ChevronDown className="size-3 shrink-0" />
			</button>

			{open && (
				<div
					className="absolute bottom-full left-0 z-[50] mb-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
					onKeyDown={(e) => {
						if (e.key === 'Escape') onOpenChangeRef.current(false);
						e.stopPropagation();
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{noModels ? (
						<div className="px-3 py-4 text-center">
							<p className="text-[11px] text-muted-foreground">
								{catalogError || 'No models available. Connect a provider to get started.'}
							</p>
							<button
								type="button"
								className="mt-2 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
								onClick={(e) => {
									e.stopPropagation();
									onOpenChange(false);
									const store = useCanvasStore.getState(); store.setMaximizedCardId(null); store.setActiveView('providers');
								}}
							>
								Open Providers
							</button>
						</div>
					) : (
						<>
							<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
								<Search className="size-3 text-muted-foreground" />
								<input
									autoFocus
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search models"
									className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
								/>
							</div>

							<div className="nowheel nodrag max-h-64 overflow-y-auto py-1">
								{catalogError && (
									<p className="mx-1.5 mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500/90">
										{catalogError}
									</p>
								)}
								{sections.length === 0 && (
									<p className="px-2 py-1 text-[11px] text-muted-foreground">No models found</p>
								)}
								{sections.map((section) => {
									const showProvider =
										section.title === 'Favorites' || section.title === 'Recents';
									return (
										<div key={section.title} className="pb-1">
											<p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
												{section.title}
											</p>
											{section.models.map((m) => {
												const active = m.label === value;
												const favorite = favoriteSet.has(m.label);
												return (
													<div
														key={`${section.title}:${m.label}`}
														className={cn(
															'group flex items-center gap-1.5 pr-1.5',
															active ? 'bg-primary/10' : 'hover:bg-secondary',
														)}
													>
														<button
															type="button"
															className="flex min-w-0 flex-1 items-baseline gap-1.5 px-2 py-1 text-left"
															onClick={() => select(m.label)}
														>
															<span
																className={cn(
																	'truncate text-[11px]',
																	active ? 'font-medium text-primary' : 'text-card-foreground',
																)}
															>
																{m.name}
															</span>
															{showProvider && (
																<span className="shrink-0 text-[9px] text-muted-foreground">
																	{m.providerName}
																</span>
															)}
														</button>
														<button
															type="button"
															aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
															title={favorite ? 'Remove from favorites' : 'Add to favorites'}
															className={cn(
																'grid size-5 shrink-0 place-items-center rounded transition-opacity',
																favorite
																	? 'text-amber-400 opacity-100'
																	: 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100',
															)}
															onClick={(e) => {
																e.stopPropagation();
																toggleFavorite(m.label);
															}}
														>
															<Star
																className={cn('size-3', favorite && 'fill-current')}
															/>
														</button>
													</div>
												);
											})}
										</div>
									);
								})}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
