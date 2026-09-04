import {
	useEffect,
	useRef,
	useState,
	type HTMLAttributes,
	type ReactNode,
	type RefObject,
} from "react";
import { Check, Copy } from "lucide-react";
import {
	extractTableDataFromElement,
	tableDataToMarkdown,
	type ExtraProps,
} from "streamdown";
import { cn } from "@/lib/utils";
import { MelonArtifact, MelonArtifactButton } from "./melon-artifact";

/**
 * Melon-owned markdown table chrome.
 *
 * Streamdown still emits thead/tbody/tr/th/td; Melon wraps the table in the
 * same quiet artifact frame as code fences. Scroll lives on an outer container
 * so the table keeps real table layout (not display:block).
 */

function TableCopyButton({ tableRef }: { tableRef: RefObject<HTMLTableElement | null> }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1400);
		return () => window.clearTimeout(id);
	}, [copied]);

	return (
		<MelonArtifactButton
			title={copied ? "Copied" : "Copy as Markdown"}
			onClick={() => {
				const el = tableRef.current;
				if (!el) return;
				const md = tableDataToMarkdown(extractTableDataFromElement(el));
				void navigator.clipboard.writeText(md).then(() => setCopied(true));
			}}
		>
			{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
		</MelonArtifactButton>
	);
}

export function MelonTable({
	className,
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLTableElement> & ExtraProps) {
	const tableRef = useRef<HTMLTableElement>(null);

	return (
		<MelonArtifact
			kind="table"
			label="table"
			actions={<TableCopyButton tableRef={tableRef} />}
		>
			<div className="melon-table-scroll nowheel">
				<table
					ref={tableRef}
					className={cn("melon-table", className)}
					data-melon="table-el"
					{...rest}
				>
					{children}
				</table>
			</div>
		</MelonArtifact>
	);
}

/** Dense Melon styles for Streamdown's default thead/th/td nodes. */
export function MelonThead({
	className,
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLTableSectionElement> & ExtraProps) {
	return (
		<thead className={cn("melon-table-head", className)} {...rest}>
			{children}
		</thead>
	);
}

export function MelonTh({
	className,
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLTableCellElement> & ExtraProps) {
	return (
		<th className={cn("melon-table-th", className)} {...rest}>
			{children as ReactNode}
		</th>
	);
}

export function MelonTd({
	className,
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLTableCellElement> & ExtraProps) {
	return (
		<td className={cn("melon-table-td", className)} {...rest}>
			{children as ReactNode}
		</td>
	);
}
