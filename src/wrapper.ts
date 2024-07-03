import * as vscode from 'vscode';
import { OpenAI } from 'openai';
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
    private client: any;
    private isAzure: boolean;
    private azureApiKey?: string;
    private azureEndpoint?: string;
    private azureDeployment?: string;
    private listAssistantsFunc: any;
    private callAssistant: any;

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
            this.client = new OpenAI({ apiKey: config.apiKey });
        }
    }

    async init() {
        const { listAssistants, callAssistant } = await import('./agent.mjs');
        this.listAssistantsFunc = listAssistants;
        this.callAssistant = callAssistant;
    }

    async getAssistants(): Promise<Assistant[]> {
        if (this.isAzure && this.azureEndpoint && this.azureApiKey) {
            const assistants = await this.listAssistantsFunc(this.azureEndpoint, this.azureApiKey);
            return assistants.map((assistant: any) => ({
                id: assistant.id,
                name: assistant.name,
            }));
        } else {
            const assistants = await this.client.beta.assistants.list({
                order: "desc",
                limit: 20,
            });
            return assistants.data;
        }
    }

    async createAndPollRun(assistantId: string, question: string): Promise<any> {
        console.log('createAndPollRun called with:', { assistantId, question });
        const thread = await this.client.beta.threads.create();
        console.log('Thread created:', thread);
        console.log('Thread ID:', thread.id);

        await this.client.beta.threads.messages.create(thread.id, { role: 'user', content: question });
        console.log('User message created with content:', question);

        const run = await this.client.beta.threads.runs.createAndPoll(thread.id, { assistant_id: assistantId });
        console.log('Run created and polled:', run);
        console.log('Run ID:', run.id);
        console.log('Run status:', run.status);

        if (run && run.status === 'completed') {
            console.log('Run completed successfully');

            const messages = await this.client.beta.threads.messages.list(thread.id);
            console.log('Retrieved messages:', messages);
            console.log('Number of messages:', messages.data.length);

            const assistantMessage = messages.data.find((msg: any) => msg.role === 'assistant' && msg.run_id === run.id);
            console.log('Found assistant message:', assistantMessage);

            if (assistantMessage && assistantMessage.content && Array.isArray(assistantMessage.content)) {
                console.log('Assistant message content is an array');
                console.log('Number of content blocks in assistant message:', assistantMessage.content.length);

                const content = assistantMessage.content
                    .filter((part: any): part is TextContentBlock => part.type === 'text' && 'text' in part && 'value' in part.text)
                    .map((part: TextContentBlock) => part.text.value)
                    .join('');
                console.log('Filtered and mapped assistant response content:', content);
                return { content };
            } else {
                console.error('Unexpected structure of assistant message:', assistantMessage);
                console.error('Assistant message content:', assistantMessage?.content);
                throw new Error('Unexpected structure of assistant message');
            }
        } else {
            console.error('Run failed or did not complete');
            console.error('Run status:', run?.status);
            console.error('Run error:', run?.last_error);
            throw new Error('Run failed or did not complete');
        }
    }
}

export async function registerChatParticipant(context: vscode.ExtensionContext, wrapper: Wrapper, model: string, assistantId: string | undefined, configuration: vscode.WorkspaceConfiguration) {
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

                const run = await wrapper.createAndPollRun(assistantId, userMessage);

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