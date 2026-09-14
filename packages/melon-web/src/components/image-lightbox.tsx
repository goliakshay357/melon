import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { create } from 'zustand';

/**
 * Click-to-zoom for composer chips and message thumbs.
 * Same Escape nesting as VizFullscreenLayer: capture + stop so maximized
 * cards don't also close on the first Esc.
 */
interface ImageLightboxState {
	src: string | null;
	alt: string;
	open: (src: string, alt?: string) => void;
	close: () => void;
}

export const useImageLightbox = create<ImageLightboxState>((set) => ({
	src: null,
	alt: '',
	open: (src, alt = 'Attached image') => set({ src, alt }),
	close: () => set({ src: null, alt: '' }),
}));

export const ImageLightboxLayer = memo(function ImageLightboxLayer() {
	const { src, alt, close } = useImageLightbox();

	useEffect(() => {
		if (!src) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			e.stopImmediatePropagation();
			close();
		};
		window.addEventListener('keydown', onKey, { capture: true });
		return () => window.removeEventListener('keydown', onKey, { capture: true });
	}, [src, close]);

	if (!src) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[1001] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label={alt}
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) {
					e.stopPropagation();
					close();
				}
			}}
		>
			<div
				className="mb-2 flex shrink-0 items-center gap-2"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-white/70">
					{alt}
				</span>
				<button
					type="button"
					onClick={close}
					title="Close (Esc)"
					className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20 hover:text-white"
				>
					<X className="size-3.5" /> exit
				</button>
			</div>
			<div
				className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<img
					alt={alt}
					src={src}
					className="max-h-full max-w-full object-contain"
					draggable={false}
				/>
			</div>
		</div>,
		document.body,
	);
});
