import type { ChatImage, ComposerAttachment } from "@/types/session-card";

export const MAX_COMPOSER_ATTACHMENTS = 10;
export const MAX_COMPOSER_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const COMPOSER_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

const acceptedImageMimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const imageMimeByExtension = new Map([
	["gif", "image/gif"],
	["jpeg", "image/jpeg"],
	["jpg", "image/jpeg"],
	["png", "image/png"],
	["webp", "image/webp"],
]);

export class UnsupportedAttachmentTypeError extends Error {
	constructor(fileName: string) {
		super(`${fileName} is not a supported image type.`);
		this.name = "UnsupportedAttachmentTypeError";
	}
}

function normalizedMimeType(type: string): string {
	return type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function fileExtension(name: string): string {
	const extension = name.split(".").pop();
	return extension && extension !== name ? extension.toLowerCase() : "";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return globalThis.btoa(binary);
}

/** True when the file is (or likely is) an image attachment. */
export function fileRequiresImageCapability(file: File): boolean {
	const mime = normalizedMimeType(file.type);
	if ((acceptedImageMimeTypes as readonly string[]).includes(mime)) return true;
	const fallbackMime = imageMimeByExtension.get(fileExtension(file.name));
	return Boolean(fallbackMime) && (!mime || mime === "application/octet-stream");
}

function resolveImageMime(file: File): string | undefined {
	const mime = normalizedMimeType(file.type);
	if ((acceptedImageMimeTypes as readonly string[]).includes(mime)) return mime;
	const fallbackMime = imageMimeByExtension.get(fileExtension(file.name));
	if ((!mime || mime === "application/octet-stream") && fallbackMime) return fallbackMime;
	return undefined;
}

export function formatAttachmentSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Convert a browser File into a composer image attachment. */
export async function fileToComposerAttachment(file: File): Promise<ComposerAttachment> {
	const buffer = await file.arrayBuffer();
	const mime = resolveImageMime(file);
	if (!mime) throw new UnsupportedAttachmentTypeError(file.name);
	return {
		id: `att_${crypto.randomUUID()}`,
		kind: "image",
		mime,
		name: file.name || "image",
		size: file.size,
		contentBase64: arrayBufferToBase64(buffer),
	};
}

export function attachmentToChatImage(attachment: ComposerAttachment): ChatImage {
	return {
		mimeType: attachment.mime,
		data: attachment.contentBase64,
		name: attachment.name,
	};
}

export function attachmentToPromptImage(attachment: ComposerAttachment): {
	type: "image";
	data: string;
	mimeType: string;
} {
	return {
		type: "image",
		data: attachment.contentBase64,
		mimeType: attachment.mime,
	};
}

export function attachmentDataUrl(attachment: Pick<ComposerAttachment, "mime" | "contentBase64">): string {
	return `data:${attachment.mime};base64,${attachment.contentBase64}`;
}

export function chatImageDataUrl(image: ChatImage): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

/** Collect File objects from a clipboard or drop DataTransfer. */
export function filesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
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

export function dataTransferHasFiles(data: DataTransfer | null | undefined): boolean {
	if (!data) return false;
	if (Array.from(data.types).includes("Files")) return true;
	return filesFromDataTransfer(data).length > 0;
}
