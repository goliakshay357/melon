import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Quiet frame shared by fenced code, tables, and other markdown artifacts. */
export function MelonArtifact({
	kind,
	label,
	actions,
	children,
	className,
}: {
	kind: "code" | "table";
	label: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("melon-artifact", className)} data-melon={kind}>
			<div className="melon-artifact-toolbar">
				<span className="melon-artifact-label">{label}</span>
				{actions ? <div className="melon-artifact-actions">{actions}</div> : null}
			</div>
			{children}
		</div>
	);
}

export function MelonArtifactButton({
	title,
	onClick,
	disabled,
	children,
}: {
	title: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="melon-artifact-btn"
			title={title}
			aria-label={title}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
