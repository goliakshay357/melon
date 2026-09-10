// Melon ask_question extension — card question panel for non-Cursor providers.
//
// Cursor already ships `cursor_ask_question` via pi-cursor-sdk. Claude Code's
// built-in AskUserQuestion is disallowed by @fractaal/pi-claude-bridge (Pi owns
// tools via MCP). Antigravity has no native ask tool. This extension registers
// Melon `ask_question`, which drives CardExtensionUiBridge select/input so
// Claude / Antigravity / other non-Cursor cards can pause for user choices.
//
// Loaded into every Melon session via additionalExtensionPaths; active only
// when the card model is not Cursor.
import { Type } from "@earendil-works/pi-ai";
import { CURSOR_PROVIDER_ID } from "./cursor-extension.js";
export const MELON_ASK_QUESTION_TOOL_NAME = "ask_question";
const QuestionOptionSchema = Type.Union([
    Type.String(),
    Type.Object({
        label: Type.String({ description: "User-facing option label" }),
        value: Type.Optional(Type.String({ description: "Optional value returned to the model; defaults to label" })),
        description: Type.Optional(Type.String({ description: "Optional helper text shown in Melon's question panel" })),
    }),
]);
const QuestionSchema = Type.Object({
    id: Type.Optional(Type.String({ description: "Stable question identifier" })),
    question: Type.Optional(Type.String({ description: "Question to ask the user" })),
    prompt: Type.Optional(Type.String({ description: "Alias for question" })),
    options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Choices the user can select" })),
    choices: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Alias for options" })),
    allowCustom: Type.Optional(Type.Boolean({ description: "Allow a typed answer in addition to listed options; defaults to true" })),
});
const MelonAskQuestionParamsSchema = Type.Object({
    question: Type.Optional(Type.String({ description: "Question to ask the user" })),
    prompt: Type.Optional(Type.String({ description: "Alias for question" })),
    options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Choices the user can select" })),
    choices: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Alias for options" })),
    allowCustom: Type.Optional(Type.Boolean({ description: "Allow a typed answer in addition to listed options; defaults to true" })),
    questions: Type.Optional(Type.Array(QuestionSchema, { description: "Ask multiple questions sequentially" })),
});
function normalizeOption(option, index) {
    if (typeof option === "string") {
        const trimmed = option.trim();
        return trimmed ? { label: trimmed, value: trimmed } : undefined;
    }
    const label = option.label?.trim() || option.value?.trim() || `Option ${index + 1}`;
    return {
        label,
        value: option.value?.trim() || label,
        ...(option.description?.trim() ? { description: option.description.trim() } : {}),
    };
}
function normalizeOptions(options) {
    return (options ?? []).map(normalizeOption).filter((option) => option !== undefined);
}
function normalizeQuestion(raw, index) {
    const question = raw.question?.trim() || raw.prompt?.trim();
    if (!question)
        return undefined;
    return {
        id: raw.id?.trim() || `question_${index + 1}`,
        question,
        options: normalizeOptions(raw.options ?? raw.choices),
        allowCustom: raw.allowCustom !== false,
    };
}
/** Exported for unit tests. */
export function normalizeQuestions(params) {
    const rawList = Array.isArray(params.questions) && params.questions.length > 0 ? params.questions : [params];
    return rawList
        .map((raw, index) => normalizeQuestion(raw, index))
        .filter((question) => question !== undefined);
}
function summarizeAnswers(answers) {
    return [
        "User answers:",
        ...answers.map((answer) => {
            const value = answer.cancelled || answer.answer === null ? "cancelled" : answer.answer;
            return `- ${answer.id}: ${value}`;
        }),
    ].join("\n");
}
async function askOneQuestion(question, ctx) {
    if (question.options.length > 0) {
        const labels = question.options.map((option) => option.description ? `${option.label} — ${option.description}` : option.label);
        const customLabel = "Type a custom answer";
        const choices = question.allowCustom ? [...labels, customLabel] : labels;
        const selected = await ctx.ui.select(question.question, choices);
        if (!selected) {
            return { id: question.id, question: question.question, answer: null, wasCustom: false, cancelled: true };
        }
        if (selected === customLabel) {
            const customAnswer = await ctx.ui.input(question.question, "Type your answer");
            const trimmed = customAnswer?.trim();
            return trimmed
                ? {
                    id: question.id,
                    question: question.question,
                    answer: trimmed,
                    value: trimmed,
                    wasCustom: true,
                    cancelled: false,
                }
                : { id: question.id, question: question.question, answer: null, wasCustom: true, cancelled: true };
        }
        const selectedIndex = labels.indexOf(selected);
        const selectedOption = selectedIndex >= 0 ? question.options[selectedIndex] : undefined;
        const answer = selectedOption?.label ?? selected;
        return {
            id: question.id,
            question: question.question,
            answer,
            value: selectedOption?.value ?? answer,
            wasCustom: false,
            cancelled: false,
        };
    }
    const answer = await ctx.ui.input(question.question, "Type your answer");
    const trimmed = answer?.trim();
    return trimmed
        ? {
            id: question.id,
            question: question.question,
            answer: trimmed,
            value: trimmed,
            wasCustom: true,
            cancelled: false,
        }
        : { id: question.id, question: question.question, answer: null, wasCustom: true, cancelled: true };
}
function isCursorModel(model) {
    return (model?.provider ?? "").toLowerCase() === CURSOR_PROVIDER_ID;
}
function syncAskQuestionToolForModel(pi, model) {
    const active = new Set(pi.getActiveTools());
    // Cursor already has cursor_ask_question; keep Melon's tool for everyone else
    // (Claude Code via MCP bridge, Antigravity, Anthropic, …).
    const shouldBeActive = !isCursorModel(model);
    const alreadyActive = active.has(MELON_ASK_QUESTION_TOOL_NAME);
    if (shouldBeActive === alreadyActive)
        return;
    if (shouldBeActive)
        active.add(MELON_ASK_QUESTION_TOOL_NAME);
    else
        active.delete(MELON_ASK_QUESTION_TOOL_NAME);
    pi.setActiveTools([...active]);
}
export default function melonAskQuestionExtension(pi) {
    pi.registerTool({
        name: MELON_ASK_QUESTION_TOOL_NAME,
        label: "Ask question",
        description: "Ask the user a clarifying question in Melon's chat card. Use when user preferences materially affect the next step; provide options when possible.",
        promptSnippet: "Ask the user a clarifying question through Melon's question panel",
        executionMode: "sequential",
        parameters: MelonAskQuestionParamsSchema,
        promptGuidelines: [
            "Use ask_question when user input would materially change the plan, scope, platform, or implementation path.",
            "Prefer ask_question with 2-4 concrete options instead of guessing.",
            "Write like you're talking to a smart friend who is new here. Short. Everyday words.",
        ],
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const questions = normalizeQuestions(params);
            if (questions.length === 0) {
                throw new Error("No valid question was provided.");
            }
            if (!ctx.hasUI) {
                throw new Error("Cannot ask the user because Melon UI is unavailable. Make a reasonable default choice and state the assumption before proceeding.");
            }
            const answers = [];
            for (const question of questions) {
                const answer = await askOneQuestion(question, ctx);
                answers.push(answer);
                if (answer.cancelled)
                    break;
            }
            return {
                content: [{ type: "text", text: summarizeAnswers(answers) }],
                details: {
                    questions,
                    answers,
                    uiAvailable: true,
                    cancelled: answers.some((answer) => answer.cancelled),
                },
            };
        },
    });
    pi.on("session_start", (_event, ctx) => {
        syncAskQuestionToolForModel(pi, ctx.model);
    });
    pi.on("model_select", (_event, ctx) => {
        syncAskQuestionToolForModel(pi, ctx.model);
    });
}
//# sourceMappingURL=melon-ask-question-extension.js.map