import { cn } from '@/lib/utils';

// Stagger the columns and outer rows so the pulse travels across the grid,
// matching Supernova's loader.
const DOT_DELAYS = [
	'[animation-delay:90ms]',
	'[animation-delay:180ms]',
	'[animation-delay:270ms]',
	'[animation-delay:0ms]',
	'[animation-delay:90ms]',
	'[animation-delay:180ms]',
	'[animation-delay:90ms]',
	'[animation-delay:180ms]',
	'[animation-delay:270ms]',
];

/** 3x3 grid of softly pulsing dots — the "AI is working" indicator. */
export function MatrixLoader() {
	return (
		<span aria-hidden className="grid shrink-0 grid-cols-3 gap-px">
			{DOT_DELAYS.map((delay, index) => (
				<span
					key={index}
					className={cn(
						'size-[3px] animate-pulse rounded-full bg-current [animation-duration:900ms] [animation-timing-function:ease-in-out] motion-reduce:animate-none motion-reduce:opacity-15',
						delay,
					)}
				/>
			))}
		</span>
	);
}
