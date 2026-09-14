import { describe, expect, it } from "vitest";
import {
	fileRequiresImageCapability,
	fileToComposerAttachment,
	formatAttachmentSize,
	MAX_COMPOSER_ATTACHMENT_BYTES,
} from "../src/lib/composer-attachments";
import { filesFromClipboard } from "../src/lib/composer-paste";

describe("composer attachments", () => {
	it("formats sizes", () => {
		expect(formatAttachmentSize(500)).toBe("500 B");
		expect(formatAttachmentSize(2048)).toBe("2 KB");
		expect(MAX_COMPOSER_ATTACHMENT_BYTES).toBeGreaterThan(1024 * 1024);
	});

	it("detects image capability from mime and extension", () => {
		expect(fileRequiresImageCapability(new File([], "shot.png", { type: "image/png" }))).toBe(true);
		expect(fileRequiresImageCapability(new File([], "shot.JPG", { type: "" }))).toBe(true);
		expect(fileRequiresImageCapability(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
	});

	it("reads a png file into a base64 attachment", async () => {
		// Minimal 1x1 PNG
		const bytes = Uint8Array.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
			0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
			0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
			0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
			0x44, 0xae, 0x42, 0x60, 0x82,
		]);
		const file = new File([bytes], "pixel.png", { type: "image/png" });
		const part = await fileToComposerAttachment(file);
		expect(part.kind).toBe("image");
		expect(part.mime).toBe("image/png");
		expect(part.contentBase64.length).toBeGreaterThan(8);
		expect(part.name).toBe("pixel.png");
	});

	it("extracts files from clipboard DataTransfer", () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.png", { type: "image/png" });
		const dt = {
			files: {
				length: 1,
				0: file,
				item: (i: number) => (i === 0 ? file : null),
				[Symbol.iterator]: function* () {
					yield file;
				},
			},
			items: [],
		} as unknown as DataTransfer;
		expect(filesFromClipboard(dt)).toHaveLength(1);
		expect(filesFromClipboard(dt)[0]?.name).toBe("clip.png");
	});
});
