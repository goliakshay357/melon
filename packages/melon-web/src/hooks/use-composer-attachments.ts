import { useCallback, useRef, useState, type DragEvent, type HTMLAttributes } from "react";
import {
	dataTransferHasFiles,
	fileRequiresImageCapability,
	fileToComposerAttachment,
	formatAttachmentSize,
	MAX_COMPOSER_ATTACHMENT_BYTES,
	MAX_COMPOSER_ATTACHMENTS,
	UnsupportedAttachmentTypeError,
} from "@/lib/composer-attachments";
import type { ComposerAttachment } from "@/types/session-card";

export type ComposerAttachmentDropZoneProps = Pick<
	HTMLAttributes<HTMLDivElement>,
	"onDragEnter" | "onDragLeave" | "onDragOver" | "onDrop"
>;

export type ComposerAttachmentsUpdate =
	| ComposerAttachment[]
	| ((attachments: ComposerAttachment[]) => ComposerAttachment[]);

export interface ComposerAttachmentsController {
	readonly addFiles: (files: readonly File[]) => void;
	readonly attachments: readonly ComposerAttachment[];
	readonly clear: () => void;
	readonly dropZoneProps: ComposerAttachmentDropZoneProps;
	readonly isDraggingFiles: boolean;
	readonly isProcessing: boolean;
	readonly remove: (attachmentId: string) => void;
}

interface UseComposerAttachmentsInput {
	readonly attachments: readonly ComposerAttachment[];
	readonly disabled?: boolean;
	readonly imageSupported?: boolean;
	readonly onAttachmentsChange: (update: ComposerAttachmentsUpdate) => void;
	readonly onNotice?: (title: string, detail: string) => void;
}

function notice(
	onNotice: UseComposerAttachmentsInput["onNotice"],
	title: string,
	detail: string,
): void {
	if (onNotice) onNotice(title, detail);
	else console.warn(`[composer] ${title}: ${detail}`);
}

/** Manages composer image attachment actions, validation, and drag/drop UI state. */
export function useComposerAttachments(
	input: UseComposerAttachmentsInput,
): ComposerAttachmentsController {
	const { attachments, disabled = false, imageSupported = true, onAttachmentsChange, onNotice } =
		input;

	const [isDraggingFiles, setIsDraggingFiles] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const dragDepthRef = useRef(0);
	const processingRef = useRef(false);

	const clear = useCallback((): void => {
		onAttachmentsChange([]);
	}, [onAttachmentsChange]);

	const remove = useCallback(
		(attachmentId: string): void => {
			onAttachmentsChange((current) => current.filter((attachment) => attachment.id !== attachmentId));
		},
		[onAttachmentsChange],
	);

	const addFiles = useCallback(
		(files: readonly File[]): void => {
			if (disabled || processingRef.current || files.length === 0) return;

			if (attachments.length + files.length > MAX_COMPOSER_ATTACHMENTS) {
				notice(onNotice, "Attachment not added", `Attach up to ${MAX_COMPOSER_ATTACHMENTS} images.`);
				return;
			}

			processingRef.current = true;
			setIsProcessing(true);

			void (async () => {
				const nextAttachments: ComposerAttachment[] = [];
				const errors: string[] = [];

				for (const file of files) {
					if (file.size > MAX_COMPOSER_ATTACHMENT_BYTES) {
						errors.push(
							`${file.name} exceeds the ${formatAttachmentSize(MAX_COMPOSER_ATTACHMENT_BYTES)} limit.`,
						);
						continue;
					}

					if (!fileRequiresImageCapability(file)) {
						errors.push(`${file.name} is not a supported image type.`);
						continue;
					}

					if (!imageSupported) {
						errors.push(
							`${file.name} is an image, but the selected model does not support images.`,
						);
						continue;
					}

					try {
						nextAttachments.push(await fileToComposerAttachment(file));
					} catch (cause) {
						errors.push(
							cause instanceof UnsupportedAttachmentTypeError
								? cause.message
								: `Could not read ${file.name}.`,
						);
					}
				}

				if (nextAttachments.length > 0) {
					onAttachmentsChange((current) => [...current, ...nextAttachments]);
				}
				for (const error of errors) {
					notice(onNotice, "Attachment not added", error);
				}

				processingRef.current = false;
				setIsProcessing(false);
			})();
		},
		[attachments.length, disabled, imageSupported, onAttachmentsChange, onNotice],
	);

	const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
		if (disabled || processingRef.current || !dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		dragDepthRef.current += 1;
		setIsDraggingFiles(true);
	};

	const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
		if (disabled || processingRef.current || !dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDraggingFiles(true);
	};

	const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
		if (disabled || processingRef.current || !dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) setIsDraggingFiles(false);
	};

	const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
		if (disabled || processingRef.current || !dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		dragDepthRef.current = 0;
		setIsDraggingFiles(false);
		addFiles(Array.from(event.dataTransfer.files));
	};

	return {
		addFiles,
		attachments,
		clear,
		dropZoneProps: {
			onDragEnter: handleDragEnter,
			onDragLeave: handleDragLeave,
			onDragOver: handleDragOver,
			onDrop: handleDrop,
		},
		isDraggingFiles,
		isProcessing,
		remove,
	};
}
