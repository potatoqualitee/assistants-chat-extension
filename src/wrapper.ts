import * as vscode from 'vscode';
import { Assistant, OpenAIWrapper } from './openai';

interface IGPTChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    };
}

export const newlineSpacing = `\n
            
\n`;

/**
 * Wrapper class for managing both OpenAI and Azure OpenAI interactions.
 */
export class Wrapper {
    private openaiWrapper: OpenAIWrapper | null = null;
    private isAzure: boolean;
    private azureApiKey?: string;
    private azureEndpoint?: string;
    private listAssistantsFunc: any;
    private callAssistantFunc: any;

    /**
     * Creates an instance of Wrapper.
     * @param config - Configuration for the wrapper.
     */
    constructor(config: {
        apiKey: string,
        endpoint?: string,
        isAzure: boolean,
        azureApiKey?: string,
        azureEndpoint?: string
    }) {
        this.isAzure = config.isAzure;
        if (this.isAzure) {
            this.azureApiKey = config.azureApiKey;
            this.azureEndpoint = config.azureEndpoint;
        } else {
            this.openaiWrapper = new OpenAIWrapper(config.apiKey);
        }
    }

    /**
     * Initializes the wrapper by importing necessary functions for Azure interactions.
     */
    async init() {
        if (this.isAzure) {
            const { listAssistants, callAssistant } = await import('./azure.mjs');
            this.listAssistantsFunc = listAssistants;
            this.callAssistantFunc = callAssistant;
        }
    }

    /**
     * Creates a sample assistant.
     * @returns The created sample assistant.
     */
    async createSampleAssistant(): Promise<Assistant | undefined> {
        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            const { createSampleAzureAssistant } = await import('./azure.mjs');
            return createSampleAzureAssistant(this.azureEndpoint, this.azureApiKey);
        } else if (!this.isAzure && this.openaiWrapper) {
            return this.openaiWrapper.createSampleAssistant();
        } else {
            console.error("Neither Azure nor OpenAI client is properly initialized");
            return undefined;
        }
    }

    /**
     * Retrieves an assistant by its ID.
     * @param assistantId - The ID of the assistant to retrieve.
     * @returns The retrieved assistant.
     */
    async retrieveAssistant(assistantId: string): Promise<Assistant | undefined> {
        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            const assistants = await this.listAssistantsFunc(this.azureEndpoint, this.azureApiKey);
            return assistants.find((assistant: any) => assistant.id === assistantId);
        } else if (this.openaiWrapper) {
            return await this.openaiWrapper.retrieveAssistant(assistantId);
        } else {
            throw new Error("Neither Azure nor OpenAI client is properly initialized");
        }
    }

    /**
     * Retrieves all assistants.
     * @returns A list of assistants.
     */
    async getAssistants(): Promise<Assistant[]> {
        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            const assistants = await this.listAssistantsFunc(this.azureEndpoint, this.azureApiKey);
            return assistants.map((assistant: any) => ({
                id: assistant.id,
                name: assistant.name,
            }));
        } else if (this.openaiWrapper) {
            return await this.openaiWrapper.listAssistants();
        } else {
            throw new Error("Neither Azure nor OpenAI client is properly initialized");
        }
    }

    /**
     * Creates and polls a run for an assistant.
     * @param assistantId - The ID of the assistant to run.
     * @param question - The question to ask the assistant.
     * @param userId - The ID of the user asking the question.
     * @param codeContext - The code context to include in the request (optional).
     * @returns The assistant's response content.
     */
    async createAndPollRun(assistantId: string | undefined, question: string, userId: string, codeContext?: { fileType: string; codeSnippet: string }): Promise<any> {
        console.debug('createAndPollRun called with:', { assistantId, question, userId, codeContext });

        if (!assistantId) {
            throw new Error("Assistant ID is required");
        }

        try {
            if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
                const response = await this.callAssistantFunc(this.azureEndpoint, this.azureApiKey, assistantId, question, userId);
                console.debug('Response from callAssistant:', response);
                return { content: response };
            } else if (this.openaiWrapper) {
                const requestWithContext = codeContext
                    ? `Code snippet in ${codeContext.fileType}:\n${codeContext.codeSnippet}\n\nQuestion: ${question}`
                    : question;

                return await this.openaiWrapper.createAndPollRun(assistantId, requestWithContext, userId);
            } else {
                throw new Error("Neither Azure nor OpenAI client is properly initialized");
            }
        } catch (error: unknown) {
            let errorMessage = "";

            if (error instanceof Error) {
                errorMessage += `${error.message}`;

                if (error.message.includes('Run status: failed')) {
                    const runDetails = (error as any).details;
                    if (runDetails) {
                        const lastError = runDetails.last_error;
                        errorMessage += `${lastError ? lastError.message : 'Unknown'}`;
                    }
                }
            } else {
                errorMessage += " An unknown error occurred.";
            }

            console.error("Error in createAndPollRun:", error);
            throw new Error(errorMessage);
        }
    }

    /**
     * Additional functionality to handle context-aware operations.
     */
    async handleContextAwareOperations() {
        const configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
        const sendCodeContext = configuration.get<boolean>('sendCodeContext', true);

        if (sendCodeContext && this.openaiWrapper) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const document = activeEditor.document;
                const fileType = document.languageId;
                const codeSnippet = document.getText();
                const tokenCount = this.estimateTokenCount(codeSnippet);

                console.log(`Context-aware operation: File type: ${fileType}, Fake token count: ${tokenCount}`);

                return { fileType, codeSnippet };
            }
        }

        return undefined;
    }

    /**
     * Estimates the token count for a given text.
     * @param text - The text to estimate the token count for.
     * @returns The estimated token count.
     */
    estimateTokenCount(text: string): number {
        return Math.ceil(text.length / 4);
    }
}

/**
 * Prompts the user to select an assistant.
 * @param wrapper - The wrapper instance for assistant interactions.
 * @param configuration - The workspace configuration.
 * @param stream - The chat response stream.
 * @returns The ID of the selected assistant.
 */
export async function promptForAssistant(wrapper: Wrapper, context: vscode.ExtensionContext, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
    const assistants = await wrapper.getAssistants();

    if (assistants.length === 0) {
        const choice = await vscode.window.showInformationMessage(
            'No assistants found. Would you like to create a sample "Beavis and Butthead" assistant?',
            'Yes',
            'No'
        );

        if (choice === 'Yes') {
            try {
                const assistant = await wrapper.createSampleAssistant();
                if (assistant) {
                    if (stream) {
                        stream.markdown(`Sample assistant "Beavis and Butthead" created successfully. You can now chat with it.${newlineSpacing}`);
                    }
                    return assistant.id;
                }
            } catch (error) {
                console.error("Error creating sample assistant:", error);
                if (stream) {
                    stream.markdown(`An error occurred while creating the sample assistant. Please create one manually using the web interface or PSOpenAI.${newlineSpacing}`);
                }
            }
        } else {
            if (stream) {
                stream.markdown(`No assistants available. Please create an assistant to proceed.${newlineSpacing}`);
            }
            return undefined;
        }
    } else if (assistants.length === 1) {
        const assistant = assistants[0];
        context.workspaceState.update('savedAssistantId', assistant.id);
        if (stream) {
            stream.markdown(`Automatically selected assistant: ${assistant.name || assistant.id}${newlineSpacing}`);
        }
        return assistant.id;
    } else {
        if (stream) {
            stream.markdown(`Please select an assistant.${newlineSpacing}`);
        }
    }

    const assistantNames = assistants.map((assistant: Assistant) => assistant.name).filter((name): name is string => name !== null);
    const selectedAssistantName = await vscode.window.showQuickPick(assistantNames, {
        placeHolder: 'Select an assistant',
    });

    if (selectedAssistantName) {
        const selectedAssistant = assistants.find((assistant: Assistant) => assistant.name === selectedAssistantName);
        if (selectedAssistant) {
            context.workspaceState.update('savedAssistantId', selectedAssistant.id);
            return selectedAssistant.id;
        }
    } else {
        if (stream) {
            stream.markdown(`No assistant selected. Please select an assistant to proceed.${newlineSpacing}`);
        }
    }

    return undefined;
}

/**
 * Registers a chat participant in VS Code.
 * @param context - The extension context.
 * @param wrapper - The wrapper instance for assistant interactions.
 * @param model - The model to use for the assistant.
 * @param assistantId - The ID of the assistant.
 * @param configuration - The workspace configuration.
 * @returns The registered chat participant.
 * 
 * This function creates a chat participant that can interact with the user.
 * It handles assistant changes, clears assistant IDs, and manages the flow of conversation.
 * The function ensures that the "Using assistant" message is shown only on the first interaction
 * or when starting a new session, and not after changing assistants.
 */
export async function registerChatParticipant(context: vscode.ExtensionContext, wrapper: Wrapper, model: string, assistantId: string): Promise<vscode.ChatParticipant> {
    let userId = context.globalState.get<string>('assistantsChatExtension.userId');
    if (!userId) {
        userId = `user_${Date.now()}`;
        context.globalState.update('assistantsChatExtension.userId', userId);
    }

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGPTChatResult> => {
        try {
            let isFirstInteraction = context.workspaceState.get<boolean>('assistantsChatExtension.isFirstInteraction', true);

            if (request.command === 'change') {
                const newAssistantId = await promptForAssistant(wrapper, context, stream);
                if (newAssistantId) {
                    assistantId = newAssistantId;
                    context.workspaceState.update('savedAssistantId', assistantId);
                    const assistants = await wrapper.getAssistants();
                    const selectedAssistant = assistants.find((assistant: Assistant) => assistant.id === assistantId);
                    if (selectedAssistant && selectedAssistant.name) {
                        stream.markdown(`You have switched to the assistant: **${selectedAssistant.name}**.${newlineSpacing}`);
                    } else {
                        stream.markdown(`You have switched to the assistant with ID: **${assistantId}**.${newlineSpacing}`);
                    }
                    isFirstInteraction = false;
                    context.workspaceState.update('assistantsChatExtension.isFirstInteraction', false);
                } else {
                    stream.markdown(`No assistant selected. Please try again.${newlineSpacing}`);
                }
                return { metadata: { command: 'change' } };
            }

            if (isFirstInteraction) {
                const assistant = await wrapper.retrieveAssistant(assistantId);
                if (assistant) {
                    stream.markdown(`Using assistant: **${assistant.name || assistant.id}**. You can use the \`/change\` command to switch assistants.${newlineSpacing}`);
                }
                isFirstInteraction = false;
                context.workspaceState.update('assistantsChatExtension.isFirstInteraction', false);
            }

            if (!assistantId) {
                stream.markdown(`No assistant selected. Please use the \`/change\` command to select an assistant.${newlineSpacing}`);
                return { metadata: { command: '' } };
            }

            if (model && assistantId) {
                const userMessage = request.prompt;

                if (userMessage.trim() === '') {
                    stream.markdown(`Please enter a non-empty message.${newlineSpacing}`);
                    return { metadata: { command: '' } };
                }

                console.debug('User message:', userMessage);

                const safeUserId = userId || `default_user_${Date.now()}`;

                const codeContext = await wrapper.handleContextAwareOperations();

                const run = await wrapper.createAndPollRun(assistantId, userMessage, safeUserId, codeContext);

                console.debug('Run created and polled:', run);

                if (run && run.content) {
                    console.debug('Assistant response content:', run.content);
                    stream.markdown(`${run.content}${newlineSpacing}`);
                } else {
                    console.error('No content in run response');
                    stream.markdown(`I'm sorry, but I couldn't generate a response. Please try again.${newlineSpacing}`);
                }
            } else {
                console.error('Model or Assistant ID is undefined. Unable to create a run.');
                stream.markdown(`There was an error processing your request. Please try again or select a different assistant.${newlineSpacing}`);
            }
        } catch (err) {
            handleError(err, stream);
        }

        return { metadata: { command: '' } };
    };

    const gpt = vscode.chat.createChatParticipant('assistant', handler);
    gpt.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    context.subscriptions.push(gpt);

    console.log(`Chat participant registered with model: ${model} and assistantId: ${assistantId}`);

    return gpt;
}

/**
 * Handles errors and sends appropriate messages to the chat response stream.
 * @param err - The error object.
 * @param stream - The chat response stream.
 */
function handleError(err: any, stream?: vscode.ChatResponseStream): void {
    let errorMessage = "An unexpected error occurred. Please try again.";

    if (err instanceof vscode.LanguageModelError) {
        console.debug(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('Incorrect API key provided')) {
            errorMessage = `The provided API key is incorrect. Please enter a valid API key in the extension settings.`;
        } else {
            errorMessage = `An error occurred while processing your request. Please try again.`;
        }
    } else if (err instanceof Error) {
        console.error('Unexpected error:', err);
        errorMessage = `${err.message}`;
    }

    if (stream) {
        stream.markdown(`${errorMessage}${newlineSpacing}`);
    }
}
