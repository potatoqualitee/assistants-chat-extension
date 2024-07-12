import * as vscode from 'vscode';
import { Assistant, OpenAIWrapper } from './openai';

interface IGPTChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    };
}

export const newlineSpacing = `\n
            
            \n`;

export class Wrapper {
    private openaiWrapper: OpenAIWrapper | null = null;
    private isAzure: boolean;
    private azureApiKey?: string;
    private azureEndpoint?: string;
    private listAssistantsFunc: any;
    private callAssistantFunc: any;

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

    async init() {
        if (this.isAzure) {
            const { listAssistants, callAssistant } = await import('./azure.mjs');
            this.listAssistantsFunc = listAssistants;
            this.callAssistantFunc = callAssistant;
        }
    }

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

    async createAndPollRun(assistantId: string | undefined, question: string, userId: string): Promise<any> {
        console.debug('createAndPollRun called with:', { assistantId, question, userId });

        if (!assistantId) {
            throw new Error("Assistant ID is required");
        }

        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            try {
                const response = await this.callAssistantFunc(this.azureEndpoint, this.azureApiKey, assistantId, question, userId);
                console.debug('Response from callAssistant:', response);
                return { content: response };
            } catch (error) {
                console.error("Error in createAndPollRun for Azure:", error);
                throw error;
            }
        } else if (this.openaiWrapper) {
            return await this.openaiWrapper.createAndPollRun(assistantId, question, userId);
        } else {
            throw new Error("Neither Azure nor OpenAI client is properly initialized");
        }
    }
}

export async function promptForAssistant(wrapper: Wrapper, configuration: vscode.WorkspaceConfiguration, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
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
        configuration.update('assistantId', assistant.id, vscode.ConfigurationTarget.Workspace);
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
            configuration.update('assistantId', selectedAssistant.id, vscode.ConfigurationTarget.Workspace);
            return selectedAssistant.id;
        }
    } else {
        if (stream) {
            stream.markdown(`No assistant selected. Please select an assistant to proceed.${newlineSpacing}`);
        }
    }

    return undefined;
}

export async function registerChatParticipant(context: vscode.ExtensionContext, wrapper: Wrapper, model: string, assistantId: string, configuration: vscode.WorkspaceConfiguration): Promise<vscode.ChatParticipant> {
    // Generate or retrieve a userId
    let userId = context.globalState.get<string>('assistantsChatExtension.userId');
    if (!userId) {
        userId = `user_${Date.now()}`;
        context.globalState.update('assistantsChatExtension.userId', userId);
    }

    let isFirstMessage = true;

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGPTChatResult> => {
        try {
            // Check if this is the first message in the conversation
            if (isFirstMessage) {
                isFirstMessage = false;
                const assistant = await wrapper.retrieveAssistant(assistantId);
                if (assistant) {
                    stream.markdown(`Using assistant: **${assistant.name || assistant.id}**. You can use the \`/change\` command to switch assistants.${newlineSpacing}`);
                }
            }

            if (request.command === 'change') {
                const newAssistantId = await promptForAssistant(wrapper, configuration, stream);
                if (newAssistantId) {
                    assistantId = newAssistantId;
                    await configuration.update('assistantId', assistantId, vscode.ConfigurationTarget.Workspace);
                    const assistants = await wrapper.getAssistants();
                    const selectedAssistant = assistants.find((assistant: Assistant) => assistant.id === assistantId);
                    if (selectedAssistant && selectedAssistant.name) {
                        stream.markdown(`You have switched to the assistant: **${selectedAssistant.name}**. How can I assist you today?${newlineSpacing}`);
                    } else {
                        stream.markdown(`You have switched to the assistant with ID: **${assistantId}**. How can I assist you today?${newlineSpacing}`);
                    }
                } else {
                    stream.markdown(`No assistant selected. Please try again.${newlineSpacing}`);
                }
                return { metadata: { command: 'change' } };
            }

            if (request.command === 'clearsaved') {
                await configuration.update('assistantId', '', vscode.ConfigurationTarget.Workspace);
                assistantId = '';
                stream.markdown(`The saved assistant ID has been cleared. Please use the \`/change\` command to select a new assistant.${newlineSpacing}`);
                return { metadata: { command: 'clearsaved' } };
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

                // Ensure userId is a string
                const safeUserId = userId || `default_user_${Date.now()}`;
                const run = await wrapper.createAndPollRun(assistantId, userMessage, safeUserId);

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

function handleError(err: any, stream?: vscode.ChatResponseStream): void {
    if (err instanceof vscode.LanguageModelError) {
        console.debug(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('Incorrect API key provided')) {
            stream?.markdown(`The provided API key is incorrect. Please enter a valid API key in the extension settings.${newlineSpacing}`);
            stream?.markdown(`To set your API key, follow these steps:\n\n1. Open the VS Code Settings (File > Preferences > Settings).\n2. Search for "Assistants Chat Extension".\n3. Enter your valid API key in the "Assistants Chat Extension: Api Key" field.\n4. Save the settings file (Ctrl+S or File > Save).\n5. You can also enter your API key via the command palette using \`assistantsChatExtension.setApiKey\`.${newlineSpacing}`);
        } else {
            stream?.markdown(`An error occurred while processing your request. Please try again.${newlineSpacing}`);
        }
    } else {
        console.error('Unexpected error:', err);
        stream?.markdown(`An unexpected error occurred. Please try again.${newlineSpacing}`);
    }
}