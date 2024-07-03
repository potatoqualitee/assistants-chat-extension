import * as vscode from 'vscode';
import OpenAI from 'openai';
import { promptForAssistant } from './assistantUtils';

interface IGPTChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    };
}

interface TextContentBlock {
    type: 'text';
    text: {
        value: string;
        annotations: Array<any>;
    };
}

export interface Assistant {
    id: string;
    name: string | null;
}

export class Wrapper {
    private openaiClient: OpenAI | null = null;
    private isAzure: boolean;
    private azureApiKey?: string;
    private azureEndpoint?: string;
    private azureDeployment?: string;
    private listAssistantsFunc: any;
    private callAssistantFunc: any;

    constructor(config: {
        apiKey: string,
        endpoint?: string,
        isAzure: boolean,
        azureApiKey?: string,
        azureEndpoint?: string,
        azureDeployment?: string
    }) {
        this.isAzure = config.isAzure;
        if (this.isAzure) {
            this.azureApiKey = config.azureApiKey;
            this.azureEndpoint = config.azureEndpoint;
            this.azureDeployment = config.azureDeployment;
        } else {
            this.openaiClient = new OpenAI({ apiKey: config.apiKey });
        }
    }

    async init() {
        if (this.isAzure) {
            const { listAssistants, callAssistant } = await import('./agent.mjs');
            this.listAssistantsFunc = listAssistants;
            this.callAssistantFunc = callAssistant;
        }
    }

    async getAssistants(): Promise<Assistant[]> {
        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            const assistants = await this.listAssistantsFunc(this.azureEndpoint, this.azureApiKey);
            return assistants.map((assistant: any) => ({
                id: assistant.id,
                name: assistant.name,
            }));
        } else if (this.openaiClient) {
            const assistants = await this.openaiClient.beta.assistants.list({
                order: "desc",
                limit: 20,
            });
            return assistants.data;
        } else {
            throw new Error("Neither Azure nor OpenAI client is properly initialized");
        }
    }

    async createAndPollRun(assistantId: string, question: string, userId: string): Promise<any> {
        console.log('createAndPollRun called with:', { assistantId, question, userId });

        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            try {
                const response = await this.callAssistantFunc(this.azureEndpoint, this.azureApiKey, assistantId, question, userId);
                console.log('Response from callAssistant:', response);
                return { content: response };
            } catch (error) {
                console.error("Error in createAndPollRun for Azure:", error);
                throw error;
            }
        } else if (this.openaiClient) {
            try {
                const thread = await this.openaiClient.beta.threads.create();
                console.log('Thread created:', thread);

                await this.openaiClient.beta.threads.messages.create(thread.id, { role: 'user', content: question });
                console.log('User message created with content:', question);

                const run = await this.openaiClient.beta.threads.runs.create(thread.id, { assistant_id: assistantId });
                console.log('Run created:', run);

                let completedRun;
                do {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    completedRun = await this.openaiClient.beta.threads.runs.retrieve(thread.id, run.id);
                } while (completedRun.status === 'queued' || completedRun.status === 'in_progress');

                console.log('Run completed:', completedRun);

                if (completedRun.status === 'completed') {
                    const messages = await this.openaiClient.beta.threads.messages.list(thread.id);
                    const assistantMessage = messages.data.find(msg => msg.role === 'assistant' && msg.run_id === run.id);

                    if (assistantMessage && assistantMessage.content && Array.isArray(assistantMessage.content)) {
                        const content = assistantMessage.content
                            .filter((part: any): part is TextContentBlock => part.type === 'text')
                            .map((part: TextContentBlock) => part.text.value)
                            .join('');
                        return { content };
                    } else {
                        throw new Error('Unexpected structure of assistant message');
                    }
                } else {
                    throw new Error(`Run failed with status: ${completedRun.status}`);
                }
            } catch (error) {
                console.error("Error in createAndPollRun for OpenAI:", error);
                throw error;
            }
        } else {
            throw new Error("Neither Azure nor OpenAI client is properly initialized");
        }
    }
}

export async function registerChatParticipant(context: vscode.ExtensionContext, wrapper: Wrapper, model: string, assistantId: string | undefined, configuration: vscode.WorkspaceConfiguration) {
    // Generate or retrieve a userId
    let userId = context.globalState.get<string>('assistantsChatExtension.userId');
    if (!userId) {
        userId = `user_${Date.now()}`;
        context.globalState.update('assistantsChatExtension.userId', userId);
    }

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGPTChatResult> => {
        try {
            if (request.command === 'change') {
                const newAssistantId = await promptForAssistant(wrapper, configuration, stream);
                if (newAssistantId) {
                    assistantId = newAssistantId;
                    const assistants = await wrapper.getAssistants();
                    const selectedAssistant = assistants.find((assistant: Assistant) => assistant.id === assistantId);
                    if (selectedAssistant && selectedAssistant.name) {
                        stream.markdown(`You have switched to the assistant: **${selectedAssistant.name}**. How can I assist you today?`);
                    } else {
                        stream.markdown(`You have switched to the assistant with ID: **${assistantId}**. How can I assist you today?`);
                    }
                } else {
                    stream.markdown('No assistant selected. Please try again.');
                }
                return { metadata: { command: 'change' } };
            }

            if (!assistantId) {
                assistantId = await promptForAssistant(wrapper, configuration, stream);
                if (!assistantId) {
                    return { metadata: { command: '' } };
                }
            }

            if (model && assistantId) {
                const userMessage = request.prompt;

                if (userMessage.trim() === '') {
                    stream.markdown('Please enter a non-empty message.');
                    return { metadata: { command: '' } };
                }

                console.log('User message:', userMessage);

                const run = await wrapper.createAndPollRun(assistantId, userMessage, userId);

                console.log('Run created and polled:', run);

                if (run && run.content) {
                    console.log('Assistant response content:', run.content);
                    stream.markdown(run.content);
                } else {
                    console.error('No content in run response');
                    stream.markdown("I'm sorry, but I couldn't generate a response. Please try again.");
                }
            } else {
                console.error('Model or Assistant ID is undefined. Unable to create a run.');
                stream.markdown("There was an error processing your request. Please try again or select a different assistant.");
            }
        } catch (err) {
            handleError(err, stream, configuration, context);
        }

        return { metadata: { command: '' } };
    };

    const gpt = vscode.chat.createChatParticipant('openai-assistant.chat', handler);
    gpt.iconPath = vscode.Uri.joinPath(context.extensionUri, 'cat.jpeg');

    context.subscriptions.push(gpt);
}

function handleError(err: any, stream?: vscode.ChatResponseStream, configuration?: vscode.WorkspaceConfiguration, context?: vscode.ExtensionContext): void {
    if (err instanceof vscode.LanguageModelError) {
        console.log(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('Incorrect API key provided')) {
            stream?.markdown('The provided API key is incorrect. Please enter a valid API key in the extension settings.');
            stream?.markdown('To set your API key, follow these steps:\n\n1. Open the VS Code Settings (File > Preferences > Settings).\n2. Search for "Assistants Chat Extension".\n3. Enter your valid API key in the "Assistants Chat Extension: Api Key" field.\n4. Save the settings file (Ctrl+S or File > Save).\n5. You can also enter your API key via the command palette using `assistantsChatExtension.setApiKey`.');
        } else {
            stream?.markdown('An error occurred while processing your request. Please try again.');
        }
    } else {
        console.error('Unexpected error:', err);
        stream?.markdown('An unexpected error occurred. Please try again.');
    }
}