/**
 * Plain-text paste for the dual-layer composer (transparent textarea +
 * mention backdrop). Keeps @-mention highlighting intact: we never insert
 * HTML into the value, only cleaned text at the caret.
 *
 * Covers terminals (ANSI / OSC), rich HTML clipboards with empty text/plain,
 * URI lists, and invisible Unicode that desyncs caret vs backdrop wrap.
 */

const MIME_PLAIN = ["text/plain", "text"];
const MIME_HTML = ["text/html"];
const MIME_URI = ["text/uri-list"];

function firstData(data: DataTransfer, types: string[]): string {
	for (const type of types) {
		try {
			const v = data.getData(type);
			if (v) return v;
		} catch {
			/* some hosts throw on unsupported MIME */
		}
	}
	return "";
}

/** Prefer text/plain; if empty (common from some terminals), recover from HTML / URI. */
export function clipboardPlainText(data: DataTransfer): string {
	const plain = firstData(data, MIME_PLAIN);
	if (plain) return plain;
	const html = firstData(data, MIME_HTML);
	if (html) return htmlToPlainText(html);
	const uri = firstData(data, MIME_URI);
	if (uri) {
		return uri
			.split(/\r\n|\n|\r/)
			.filter((line) => line && !line.startsWith("#"))
			.join("\n");
	}
	return "";
}

/** Decode a few common entities + numeric refs without needing a DOM. */
function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, n: string) => {
			const code = Number(n);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
		})
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
			const code = Number.parseInt(h, 16);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
		});
}

/** Best-effort HTML → text without a DOM (works in node tests too). */
export function htmlToPlainText(html: string): string {
	const withoutNoise = html
		.replace(/\r\n?/g, "\n")
		// Drop non-visible chrome before tag strip.
		.replace(/<\s*(script|style|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\s*br\s*\/?\s*>/gi, "\n")
		.replace(/<\/\s*(p|div|li|tr|h[1-6]|pre|blockquote)\s*>/gi, "\n")
		.replace(/<\s*\/?\s*p\b[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	return decodeEntities(withoutNoise);
}

/**
 * Strip terminal ANSI / OSC / C0 controls and invisible Unicode that break
 * wrap metrics vs the backdrop (caret then drifts under arrow keys).
 * Keep \n and \t.
 */
export function sanitizePastedText(raw: string): string {
	return (
		raw
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			// CSI: ESC [ ... final byte
			.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
			// OSC: ESC ] ... BEL or ST
			.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
			// OSC 8 hyperlinks (nested form)
			.replace(/\u001b\]8;[^\u0007]*\u0007/g, "")
			// Single-char ESC sequences
			.replace(/\u001b[@-Z\\-_]/g, "")
			// C0 / DEL except \t (09) and \n (0A)
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
			// BOM, zero-widths, soft hyphen, bidi isolates/embeddings (caret noise)
			.replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "")
			// Unicode line/paragraph separators → newline
			.replace(/[\u2028\u2029]/g, "\n")
			// Narrow / weird spaces → regular space (wrap stays predictable)
			.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
	);
}

export function plainTextFromClipboard(data: DataTransfer): string {
	return sanitizePastedText(clipboardPlainText(data));
}

/** Collect image/file blobs from a clipboard paste (Cmd/Ctrl+V screenshots). */
export function filesFromClipboard(data: DataTransfer | null | undefined): File[] {
	if (!data) return [];
	if (data.files?.length) return Array.from(data.files);
	const items = data.items ? Array.from(data.items) : [];
	const out: File[] = [];
	for (const item of items) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file) out.push(file);
	}
	return out;
}

/** Insert cleaned clipboard text into a controlled string at [start, end). */
export function insertPlainAt(
	value: string,
	start: number,
	end: number,
	piece: string,
): { next: string; caret: number } {
	const s = Math.max(0, Math.min(start, value.length));
	const e = Math.max(s, Math.min(end, value.length));
	const next = value.slice(0, s) + piece + value.slice(e);
	return { next, caret: s + piece.length };
}
