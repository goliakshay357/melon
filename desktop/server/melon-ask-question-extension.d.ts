import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare const MELON_ASK_QUESTION_TOOL_NAME = "ask_question";
interface MelonQuestionOption {
    label: string;
    value: string;
    description?: string;
}
interface MelonQuestion {
    id: string;
    question: string;
    options: MelonQuestionOption[];
    allowCustom: boolean;
}
type RawQuestionOption = string | {
    label?: string;
    value?: string;
    description?: string;
};
type RawQuestion = {
    id?: string;
    question?: string;
    prompt?: string;
    options?: RawQuestionOption[];
    choices?: RawQuestionOption[];
    allowCustom?: boolean;
};
type MelonAskQuestionParams = RawQuestion & {
    questions?: RawQuestion[];
};
/** Exported for unit tests. */
export declare function normalizeQuestions(params: MelonAskQuestionParams): MelonQuestion[];
export default function melonAskQuestionExtension(pi: ExtensionAPI): void;
export {};
//# sourceMappingURL=melon-ask-question-extension.d.ts.map